import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { createPortal } from 'react-dom'
import { Eraser, Hand, Paintbrush, RotateCcw, Trash2, Undo2, X, ZoomIn, ZoomOut } from 'lucide-react'
import type { ReferenceImage } from '@shared/types'
import { buildMaskPixels, resolveMaskOutputSize } from '@shared/mask'
import {
  clampMaskPan,
  clampMaskZoom,
  computeMaskFitScale,
  computeZoomAnchoredPan,
  createLoadTicket,
  formatMaskZoom,
  getMaskZoomAfterWheel,
  MASK_MAX_ZOOM,
  MASK_MIN_ZOOM,
  popMaskStroke,
  resolveMaskCanvasSize,
  type MaskPan,
  type MaskStroke,
  type MaskStrokePoint
} from '../../mask-editor-view'

const ZOOM_BUTTON_STEP = 0.25
const BRUSH_COLOR = 'rgba(79, 214, 168, 1)'
const LOAD_ERROR_HINT = '参考图加载失败，请切换参考图重试'

export function MaskEditor({
  references,
  onClose,
  onApply
}: {
  references: ReferenceImage[]
  onClose: () => void
  onApply: (mask: { dataUrl: string; previewUrl: string; referenceId: string }) => void
}): JSX.Element {
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  // 笔画真源放 ref：pointermove 每帧都要读，走 state 会拖慢长笔画
  const strokesRef = useRef<MaskStroke[]>([])
  const drawingRef = useRef(false)
  const panningRef = useRef<{ startX: number; startY: number; origin: MaskPan } | null>(null)
  const [activeId, setActiveId] = useState(references[0]?.id || '')
  const [tool, setTool] = useState<'brush' | 'eraser' | 'hand'>('brush')
  const [brushSize, setBrushSize] = useState(42)
  const [ready, setReady] = useState(false)
  const [strokeCount, setStrokeCount] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState<MaskPan>({ x: 0, y: 0 })
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [loadError, setLoadError] = useState<string | null>(null)
  // 拖拽中要换光标，ref 不触发重渲染，单独用 state 记一次
  const [panning, setPanning] = useState(false)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const spaceRef = useRef(false)
  // 滚轮会在同一帧内连发多次，读 state 会丢步；ref 保存最新值保证累加
  const zoomRef = useRef(1)
  const panRef = useRef<MaskPan>({ x: 0, y: 0 })
  const layoutRef = useRef({ fitScale: 1, stageWidth: 0, stageHeight: 0, canvasWidth: 0, canvasHeight: 0 })
  // 参考图异步加载的归属守卫：只让最后一次请求的结果落盘
  const loadTicketRef = useRef(createLoadTicket(''))

  const reference = references.find((item) => item.id === activeId) || references[0]
  const fitScale = computeMaskFitScale(stageSize.width, stageSize.height, canvasSize.width, canvasSize.height)
  const viewScale = fitScale * zoom
  const canApply = strokeCount > 0
  // 布局参数给 changeZoom 用：它不依赖 React 渲染周期，必须能读到最新值
  layoutRef.current = {
    fitScale,
    stageWidth: stageSize.width,
    stageHeight: stageSize.height,
    canvasWidth: canvasSize.width,
    canvasHeight: canvasSize.height
  }

  /** 画笔 / 橡皮的一笔，统一入口：单点画圆，多点画圆头线段 */
  const paint = useCallback(
    (from: MaskStrokePoint | null, to: MaskStrokePoint, size: number, mode: 'brush' | 'eraser') => {
      const context = canvasRef.current?.getContext('2d')
      if (!context) return
      context.globalCompositeOperation = mode === 'eraser' ? 'destination-out' : 'source-over'
      // 必须完全不透明：apply() 用 destination-out 挖洞，半透明画笔只能挖掉一部分 alpha
      context.fillStyle = BRUSH_COLOR
      context.strokeStyle = BRUSH_COLOR
      context.lineCap = 'round'
      context.lineJoin = 'round'
      context.lineWidth = size
      if (!from) {
        context.beginPath()
        context.arc(to.x, to.y, size / 2, 0, Math.PI * 2)
        context.fill()
        return
      }
      context.beginPath()
      context.moveTo(from.x, from.y)
      context.lineTo(to.x, to.y)
      context.stroke()
    },
    []
  )

  /** 撤销后按笔画顺序全量重放：画笔与橡皮的叠放顺序必须与原来一致 */
  const redrawAll = useCallback(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    context.globalCompositeOperation = 'source-over'
    context.clearRect(0, 0, canvas.width, canvas.height)
    for (const stroke of strokesRef.current) {
      let previous: MaskStrokePoint | null = null
      for (const point of stroke.points) {
        paint(previous, point, stroke.size, stroke.tool)
        previous = point
      }
    }
  }, [paint])

  const resetView = useCallback(() => {
    zoomRef.current = 1
    panRef.current = { x: 0, y: 0 }
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  const clearStrokes = useCallback(() => {
    // 清空时结束活动笔画：否则后续 pointermove 会把点追加到新数组末项（已不存在）
    drawingRef.current = false
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (canvas && context) {
      context.globalCompositeOperation = 'source-over'
      context.clearRect(0, 0, canvas.width, canvas.height)
    }
    strokesRef.current = []
    setStrokeCount(0)
  }, [])

  const undo = useCallback(() => {
    if (!strokesRef.current.length) return
    // 撤销可能发生在按住指针的过程中：不终止活动笔画的话，下一次 pointermove
    // 会取到数组末项（此时已是前一笔），把新点追加进去并沿用它的大小与工具。
    drawingRef.current = false
    strokesRef.current = popMaskStroke(strokesRef.current)
    setStrokeCount(strokesRef.current.length)
    redrawAll()
  }, [redrawAll])

  const onLoadError = useCallback((referenceId: string) => {
    setLoadError(referenceId)
  }, [])

  // 载入参考图：画布内部尺寸跟着原图比例走（上限 1536），并复位笔画与视图
  useEffect(() => {
    // 参考图被清空时也要复位：否则「应用遮罩」还亮着，但 canvas 已卸载、点击静默失效
    if (!reference) {
      setReady(false)
      strokesRef.current = []
      setStrokeCount(0)
      drawingRef.current = false
      imageRef.current = null
      return
    }
    const targetId = reference.id
    setReady(false)
    setLoadError(null)
    strokesRef.current = []
    setStrokeCount(0)
    drawingRef.current = false
    resetView()
    const ticket = loadTicketRef.current.begin(targetId)
    const image = new Image()
    // 加载有先后：A 慢、B 快时 A 的 onload 迟到会覆盖 B 的画布与导出尺寸。
    // ticket 记录最后一次请求，迟到的回调一律丢弃。
    image.onload = () => {
      if (!loadTicketRef.current.isCurrent(targetId, ticket)) return
      imageRef.current = image
      const { width, height } = resolveMaskCanvasSize(image.naturalWidth, image.naturalHeight)
      const canvas = canvasRef.current
      if (!canvas) return
      // 给 canvas.width 赋值会清空画布。首开面板时图片解码可能慢于用户开始涂抹，
      // 此时已有笔画，清空后必须按笔画重放，否则画面与 strokesRef 不一致。
      canvas.width = width
      canvas.height = height
      setCanvasSize({ width, height })
      const context = canvas.getContext('2d')
      context?.clearRect(0, 0, canvas.width, canvas.height)
      if (strokesRef.current.length) redrawAll()
      setReady(true)
    }
    image.onerror = () => {
      if (!loadTicketRef.current.isCurrent(targetId, ticket)) return
      imageRef.current = null
      setReady(false)
      onLoadError(targetId)
    }
    image.src = window.pictverse.reference.url(targetId)
    return () => {
      // 卸载或切图时让在途请求作废，迟到的 onload 不会再改画布
      loadTicketRef.current.invalidate()
    }
  }, [reference?.id, resetView, redrawAll, onLoadError])

  // 编辑区尺寸随窗口变化，fit 比例要跟着重算，否则窗口一缩图片就溢出
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    let lastWidth = 0
    let lastHeight = 0
    const apply = (width: number, height: number) => {
      // 尺寸没变就别 setState：ResizeObserver 在滚动条抖动等场景会重复回调，
      // 每次 setState 都会让 wheel 监听重挂，快速滚轮时可能丢事件。
      if (width === lastWidth && height === lastHeight) return
      lastWidth = width
      lastHeight = height
      setStageSize({ width, height })
    }
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (box) apply(box.width, box.height)
    })
    observer.observe(stage)
    const rect = stage.getBoundingClientRect()
    apply(rect.width, rect.height)
    return () => observer.disconnect()
  }, [])

  /**
   * 布局变化（窗口缩放、画布尺寸变化）后重新钳制平移量。
   * 不重钳的话：放大后拖到边缘，再缩小窗口，旧 pan 会把整张图推出编辑区，用户看不到也涂不到。
   */
  useEffect(() => {
    if (!stageSize.width || !canvasSize.width) return
    const next = clampMaskPan(
      panRef.current,
      stageSize.width,
      stageSize.height,
      canvasSize.width * viewScale,
      canvasSize.height * viewScale
    )
    if (next.x === panRef.current.x && next.y === panRef.current.y) return
    panRef.current = next
    setPan(next)
  }, [stageSize.width, stageSize.height, canvasSize.width, canvasSize.height, viewScale])

  // Ctrl/Cmd+Z 撤销，Esc 关闭
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        undo()
        return
      }
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, onClose])

  // 空格临时拖图：画笔/橡皮下不用切工具也能挪画面（与修图软件一致）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return
      // 焦点在滑杆/按钮上时不抢空格，避免误触
      const tag = (event.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'TEXTAREA') return
      event.preventDefault()
      spaceRef.current = true
      setSpaceHeld(true)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      spaceRef.current = false
      setSpaceHeld(false)
    }
    // 窗口失焦时按键抬起收不到，必须复位，否则会一直处于拖拽态
    const onBlur = () => {
      spaceRef.current = false
      setSpaceHeld(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  /** 屏幕坐标 → 画布内部像素坐标。rect 已反映 transform 后的真实尺寸，缩放不用另行反算 */
  const toCanvasPoint = (event: ReactPointerEvent<HTMLCanvasElement>): MaskStrokePoint | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height
    }
  }

  /**
   * 缩放入口。滚轮会在同一帧里连发多次，读 state 拿到的是上一次渲染的旧值，
   * 连续滚动就会丢步，所以当前值一律走 ref。
   * 布局参数也走 ref：否则 changeZoom 每次依赖变化都会让 wheel 监听重挂。
   */
  const changeZoom = useCallback((nextZoom: number, cursor?: MaskStrokePoint) => {
    const clamped = clampMaskZoom(nextZoom)
    const currentZoom = zoomRef.current
    if (clamped === currentZoom) return
    const layout = layoutRef.current
    const nextScale = layout.fitScale * clamped
    const stage = stageRef.current
    if (cursor && stage) {
      const rect = stage.getBoundingClientRect()
      panRef.current = computeZoomAnchoredPan(
        panRef.current,
        cursor,
        { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        layout.fitScale * currentZoom,
        nextScale
      )
    }
    // 缩小时内容变小，原来的平移量可能把图推到很偏的位置，这里重新钳制
    panRef.current = clampMaskPan(
      panRef.current,
      layout.stageWidth,
      layout.stageHeight,
      layout.canvasWidth * nextScale,
      layout.canvasHeight * nextScale
    )
    setPan(panRef.current)
    zoomRef.current = clamped
    setZoom(clamped)
  }, [])

  /**
   * 滚轮缩放必须用原生非 passive 监听：
   * React 的 onWheel 走 passive 监听，里面调 preventDefault() 无效且会在控制台报错，
   * 滚动会同时带动外层容器。
   */
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const onWheel = (event: WheelEvent) => {
      if (!event.deltaY) return
      event.preventDefault()
      changeZoom(getMaskZoomAfterWheel(zoomRef.current, event.deltaY), {
        x: event.clientX,
        y: event.clientY
      })
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [changeZoom])

  const apply = () => {
    const canvas = canvasRef.current
    const image = imageRef.current
    if (!canvas) return

    // 导出前先按笔画真源重放：实时增量绘制依赖逐帧合成，浏览器首次光栅化
    // 会在抗锯齿边缘留下极少量差异；重放保证「看到的结果」与「笔画记录」一致，
    // 导出的遮罩因此可复现，不会随绘制先后抖动。
    redrawAll()

    // 遮罩必须与上传的原图同尺寸，否则上游会忽略或直接 400；
    // 编辑画布按上限缩过，这里要还原成参考图的原始尺寸。
    const { width, height } = resolveMaskOutputSize(
      image?.naturalWidth ?? 0,
      image?.naturalHeight ?? 0,
      canvas.width,
      canvas.height
    )

    // 涂抹层按原图尺寸重采样，后面同时作为 mask 与预览的输入
    const strokeCanvas = document.createElement('canvas')
    strokeCanvas.width = width
    strokeCanvas.height = height
    const strokeCtx = strokeCanvas.getContext('2d')
    if (!strokeCtx) return
    strokeCtx.drawImage(canvas, 0, 0, width, height)

    // 上传用：[OI] 遮罩约定 —— 透明区域 = 需要重绘，不透明区域 = 保留原图
    const maskCanvas = document.createElement('canvas')
    maskCanvas.width = width
    maskCanvas.height = height
    const maskCtx = maskCanvas.getContext('2d')
    if (!maskCtx) return
    const strokeData = strokeCtx.getImageData(0, 0, width, height)
    const maskData = maskCtx.createImageData(width, height)
    maskData.data.set(buildMaskPixels(strokeData.data))
    maskCtx.putImageData(maskData, 0, 0)

    // 预览用：把涂抹区域染成半透明薄荷色，方便在缩略图和预览里直接看到遮罩范围
    const previewCanvas = document.createElement('canvas')
    previewCanvas.width = width
    previewCanvas.height = height
    const previewCtx = previewCanvas.getContext('2d')
    if (!previewCtx) return
    previewCtx.drawImage(strokeCanvas, 0, 0)
    previewCtx.globalCompositeOperation = 'source-in'
    previewCtx.fillStyle = 'rgba(79, 214, 168, 0.62)'
    previewCtx.fillRect(0, 0, previewCanvas.width, previewCanvas.height)

    onApply({
      dataUrl: maskCanvas.toDataURL('image/png'),
      previewUrl: previewCanvas.toDataURL('image/png'),
      referenceId: reference?.id || ''
    })
  }

  return createPortal(
    <div
      className="modal open"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="mask-panel">
        <div className="mask-head">
          <span>遮罩编辑</span>
          <span className="pill tiny">涂抹需要重绘的区域</span>
          <button className="history-close" onClick={onClose} title="关闭">
            <X size={15} />
          </button>
        </div>
        {/* 没有参考图时不能渲染画布：reference.id 会抛错，也不存在可涂的图 */}
        {!reference ? (
          <div className="mask-stage mask-stage-empty">
            <span>还没有参考图，先在输入区添加一张再涂抹遮罩</span>
          </div>
        ) : (
          <>
            {references.length > 1 ? (
              <div className="mask-refs">
                <span className="mask-refs-label">选择参考图</span>
                {references.map((item) => (
                  <button
                    key={item.id}
                    className={`mask-ref ${item.id === reference.id ? 'on' : ''}`}
                    title={item.name}
                    onClick={() => setActiveId(item.id)}
                  >
                    <img src={window.pictverse.reference.url(item.id)} alt={item.name} />
                  </button>
                ))}
              </div>
            ) : null}

            <div
              className={`mask-stage ${tool === 'hand' || spaceHeld ? 'tool-hand' : ''} ${panning ? 'panning' : ''}`}
              ref={stageRef}
              onPointerDown={(event) => {
                // 手形工具或按住空格：左键直接拖图；画笔/橡皮下保留中键与 Alt+左键，
                // 这样不用切工具也能临时挪一下画面。
                const handDrag = (tool === 'hand' || spaceRef.current) && event.button === 0
                const tempDrag = event.button === 1 || (event.button === 0 && event.altKey)
                if (!handDrag && !tempDrag) return
                event.preventDefault()
                event.currentTarget.setPointerCapture(event.pointerId)
                panningRef.current = { startX: event.clientX, startY: event.clientY, origin: panRef.current }
                setPanning(true)
              }}
              onPointerMove={(event) => {
                const start = panningRef.current
                if (!start) return
                panRef.current = clampMaskPan(
                  { x: start.origin.x + (event.clientX - start.startX), y: start.origin.y + (event.clientY - start.startY) },
                  stageSize.width,
                  stageSize.height,
                  canvasSize.width * viewScale,
                  canvasSize.height * viewScale
                )
                setPan(panRef.current)
              }}
              onPointerUp={() => {
                panningRef.current = null
                setPanning(false)
              }}
              onPointerLeave={() => {
                panningRef.current = null
                setPanning(false)
              }}
            >
              <div
                className="mask-viewport"
                style={{
                  width: canvasSize.width || undefined,
                  height: canvasSize.height || undefined,
                  transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${viewScale})`
                }}
              >
                <img src={window.pictverse.reference.url(reference.id)} alt={reference.name} draggable={false} />
                <canvas
                  ref={canvasRef}
                  className={ready ? '' : 'pending'}
                  onPointerDown={(event) => {
                    if (event.button !== 0 || event.altKey) return
                    // 手形工具或按住空格只拖图，不落笔；事件继续冒泡到 stage 走平移
                    if (tool === 'hand' || spaceRef.current) return
                    // 图片还没解码完就落笔，笔画会随后被 canvas.width 赋值清掉，直接忽略
                    if (!ready) return
                    const point = toCanvasPoint(event)
                    if (!point) return
                    drawingRef.current = true
                    event.currentTarget.setPointerCapture(event.pointerId)
                    const stroke: MaskStroke = { tool, size: brushSize, points: [point] }
                    strokesRef.current = [...strokesRef.current, stroke]
                    setStrokeCount(strokesRef.current.length)
                    paint(null, point, brushSize, tool)
                  }}
                  onPointerMove={(event) => {
                    if (!drawingRef.current) return
                    const stroke = strokesRef.current[strokesRef.current.length - 1]
                    if (!stroke) return
                    const point = toCanvasPoint(event)
                    if (!point) return
                    const previous = stroke.points[stroke.points.length - 1]
                    // 亚像素抖动直接丢弃，避免笔画点列无限膨胀
                    if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.5) return
                    stroke.points.push(point)
                    paint(previous, point, stroke.size, stroke.tool)
                  }}
                  onPointerUp={() => {
                    if (!drawingRef.current) return
                    drawingRef.current = false
                    // 收笔后按笔画真源重放一次：实时绘制是逐段合成的，
                    // 浏览器首次光栅化会在抗锯齿边缘留下极少量差异（实测约 0.2% 像素），
                    // 归一化之后「屏幕上看到的」与「笔画记录」严格一致，撤销才不会回不到原样。
                    redrawAll()
                  }}
                  onPointerLeave={() => {
                    drawingRef.current = false
                  }}
                />
              </div>
              {/* 加载失败要明说：否则画布一直是空的，用户只会以为涂不上 */}
              {loadError ? (
                <div className="mask-load-error" role="alert">
                  {LOAD_ERROR_HINT}
                </div>
              ) : null}
            </div>
          </>
        )}

        <div className="mask-tools">
          <div className="segmented mask-seg">
            <button
              className={tool === 'brush' ? 'on' : ''}
              onClick={() => setTool('brush')}
              title="画笔：涂抹需要重绘的区域"
            >
              <Paintbrush size={13} />
              画笔
            </button>
            <button
              className={tool === 'eraser' ? 'on' : ''}
              onClick={() => setTool('eraser')}
              title="橡皮：擦掉涂过的遮罩"
            >
              <Eraser size={13} />
              橡皮
            </button>
            <button
              className={tool === 'hand' ? 'on' : ''}
              onClick={() => setTool('hand')}
              title="拖拽：按住左键移动画面（也可随时用空格、中键或 Alt+左键）"
            >
              <Hand size={13} />
              拖拽
            </button>
          </div>
          <label className={`mask-size ${tool === 'hand' ? 'muted' : ''}`}>
            笔刷
            <input
              type="range"
              min={10}
              max={120}
              value={brushSize}
              disabled={tool === 'hand'}
              onChange={(event) => setBrushSize(Number(event.target.value))}
            />
            <span>{brushSize}</span>
          </label>
          <button className="ghost" onClick={undo} disabled={!strokeCount} title="撤销上一笔（Ctrl+Z）">
            <Undo2 size={14} />
            撤销
          </button>
          <button className="ghost" onClick={clearStrokes} disabled={!strokeCount} title="清空所有笔画">
            <RotateCcw size={14} />
            重置
          </button>
          <div className="mask-zoom">
            <button
              className="mask-zoom-btn"
              onClick={() => changeZoom(zoom - ZOOM_BUTTON_STEP)}
              disabled={zoom <= MASK_MIN_ZOOM}
              title="缩小"
            >
              <ZoomOut size={14} />
            </button>
            <button className="mask-zoom-value" onClick={resetView} title="回到适应窗口（100%）">
              {formatMaskZoom(zoom)}
            </button>
            <button
              className="mask-zoom-btn"
              onClick={() => changeZoom(zoom + ZOOM_BUTTON_STEP)}
              disabled={zoom >= MASK_MAX_ZOOM}
              title="放大"
            >
              <ZoomIn size={14} />
            </button>
          </div>
          <button className="ghost" onClick={onClose}>
            <Trash2 size={14} />
            取消
          </button>
          <button className="btn-primary" disabled={!canApply} onClick={apply}>
            应用遮罩
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
