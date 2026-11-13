import { useEffect, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Eraser, Paintbrush, RotateCcw, Trash2, X } from 'lucide-react'
import type { ReferenceImage } from '@shared/types'

const CANVAS_MAX = 768

export function MaskEditor({
  references,
  onClose,
  onApply
}: {
  references: ReferenceImage[]
  onClose: () => void
  onApply: (mask: { dataUrl: string; previewUrl: string; referenceId: string }) => void
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const drawingRef = useRef(false)
  const [activeId, setActiveId] = useState(references[0]?.id || '')
  const [tool, setTool] = useState<'brush' | 'eraser'>('brush')
  const [brushSize, setBrushSize] = useState(42)
  const [ready, setReady] = useState(false)
  const [hasStroke, setHasStroke] = useState(false)

  const reference = references.find((item) => item.id === activeId) || references[0]

  useEffect(() => {
    if (!reference) return
    setReady(false)
    setHasStroke(false)
    const image = new Image()
    image.onload = () => {
      imageRef.current = image
      const scale = Math.min(1, CANVAS_MAX / Math.max(image.naturalWidth, image.naturalHeight))
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = Math.round(image.naturalWidth * scale)
      canvas.height = Math.round(image.naturalHeight * scale)
      const context = canvas.getContext('2d')
      context?.clearRect(0, 0, canvas.width, canvas.height)
      setReady(true)
    }
    image.src = window.pictverse.reference.url(reference.id)
  }, [reference?.id])

  const drawDot = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const rect = canvas.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * canvas.width
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height
    context.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'
    // 必须完全不透明：apply() 用 destination-out 挖洞，半透明画笔只能挖掉一部分 alpha
    context.fillStyle = 'rgba(79, 214, 168, 1)'
    context.beginPath()
    context.arc(x, y, brushSize / 2, 0, Math.PI * 2)
    context.fill()
    setHasStroke(true)
  }

  const clear = () => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    setHasStroke(false)
  }

  const apply = () => {
    const canvas = canvasRef.current
    if (!canvas) return

    // 上传用：[OI] 遮罩约定 —— 透明区域 = 需要重绘，不透明区域 = 保留原图
    const maskCanvas = document.createElement('canvas')
    maskCanvas.width = canvas.width
    maskCanvas.height = canvas.height
    const maskCtx = maskCanvas.getContext('2d')
    if (!maskCtx) return
    maskCtx.fillStyle = '#ffffff'
    maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height)
    maskCtx.globalCompositeOperation = 'destination-out'
    maskCtx.drawImage(canvas, 0, 0)

    // 预览用：把涂抹区域染成半透明薄荷色，方便在缩略图上直接看到遮罩范围
    const previewCanvas = document.createElement('canvas')
    previewCanvas.width = canvas.width
    previewCanvas.height = canvas.height
    const previewCtx = previewCanvas.getContext('2d')
    if (!previewCtx) return
    previewCtx.drawImage(canvas, 0, 0)
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
        {references.length > 1 ? (
          <div className="mask-refs">
            <span className="mask-refs-label">选择参考图</span>
            {references.map((item) => (
              <button
                key={item.id}
                className={`mask-ref ${item.id === reference?.id ? 'on' : ''}`}
                title={item.name}
                onClick={() => setActiveId(item.id)}
              >
                <img src={window.pictverse.reference.url(item.id)} alt={item.name} />
              </button>
            ))}
          </div>
        ) : null}

        <div className="mask-stage">
          <img src={window.pictverse.reference.url(reference.id)} alt={reference.name} draggable={false} />
          <canvas
            ref={canvasRef}
            className={ready ? '' : 'pending'}
            onPointerDown={(event) => {
              drawingRef.current = true
              event.currentTarget.setPointerCapture(event.pointerId)
              drawDot(event)
            }}
            onPointerMove={(event) => {
              if (!drawingRef.current) return
              drawDot(event)
            }}
            onPointerUp={() => {
              drawingRef.current = false
            }}
            onPointerLeave={() => {
              drawingRef.current = false
            }}
          />
        </div>

        <div className="mask-tools">
          <div className="segmented mask-seg">
            <button className={tool === 'brush' ? 'on' : ''} onClick={() => setTool('brush')}>
              <Paintbrush size={13} />
              画笔
            </button>
            <button className={tool === 'eraser' ? 'on' : ''} onClick={() => setTool('eraser')}>
              <Eraser size={13} />
              橡皮
            </button>
          </div>
          <label className="mask-size">
            笔刷
            <input
              type="range"
              min={10}
              max={120}
              value={brushSize}
              onChange={(event) => setBrushSize(Number(event.target.value))}
            />
            <span>{brushSize}</span>
          </label>
          <button className="ghost" onClick={clear}>
            <RotateCcw size={14} />
            重置
          </button>
          <button className="ghost" onClick={onClose}>
            <Trash2 size={14} />
            取消
          </button>
          <button className="btn-primary" disabled={!hasStroke} onClick={apply}>
            应用遮罩
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
