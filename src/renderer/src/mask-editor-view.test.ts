import { describe, expect, it } from 'vitest'
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
  strokeSegments,
  type MaskStroke
} from './mask-editor-view'

describe('mask editor view helpers', () => {
  it('clamps zoom into the supported range and falls back to 100% for junk input', () => {
    expect(clampMaskZoom(0.1)).toBe(MASK_MIN_ZOOM)
    expect(clampMaskZoom(9)).toBe(MASK_MAX_ZOOM)
    expect(clampMaskZoom(1.5)).toBe(1.5)
    expect(clampMaskZoom(Number.NaN)).toBe(1)
  })

  it('steps zoom by wheel direction', () => {
    expect(getMaskZoomAfterWheel(1, -1)).toBeCloseTo(1.2)
    expect(getMaskZoomAfterWheel(1, 1)).toBeCloseTo(0.8)
    expect(getMaskZoomAfterWheel(MASK_MAX_ZOOM, -1)).toBe(MASK_MAX_ZOOM)
  })

  it('formats zoom as a percentage', () => {
    expect(formatMaskZoom(1)).toBe('100%')
    expect(formatMaskZoom(0.755)).toBe('76%')
  })

  it('fits the canvas into the stage without cropping', () => {
    // 1024x1024 画布放进 800x600 的可视区：受高度限制
    expect(computeMaskFitScale(800, 600, 1024, 1024)).toBeCloseTo(600 / 1024)
    expect(computeMaskFitScale(0, 600, 1024, 1024)).toBe(1)
  })

  it('keeps canvas resolution capped but never upscales the source', () => {
    expect(resolveMaskCanvasSize(1024, 1024)).toEqual({ width: 1024, height: 1024 })
    expect(resolveMaskCanvasSize(3072, 1536)).toEqual({ width: 1536, height: 768 })
    expect(resolveMaskCanvasSize(640, 480)).toEqual({ width: 640, height: 480 })
    expect(resolveMaskCanvasSize(0, 0)).toEqual({ width: 1, height: 1 })
  })

  it('anchors zoom on the cursor so the image point under it stays put', () => {
    const center = { x: 400, y: 300 }
    const pan = { x: 0, y: 0 }
    // 光标在中心右侧 100px，缩放 1 -> 2，光标下的图像点要留在原处
    const next = computeZoomAnchoredPan(pan, { x: 500, y: 300 }, center, 1, 2)

    // 缩放前：该图像点相对中心的偏移是 100 / 1 = 100，屏幕位置 500
    // 缩放后：偏移 100 * 2 = 200，要留在 500，pan.x = 500 - 400 - 200 = -100
    expect(next.x).toBeCloseTo(-100)
    expect(next.y).toBeCloseTo(0)
  })

  it('leaves pan untouched for degenerate scales', () => {
    expect(computeZoomAnchoredPan({ x: 5, y: 6 }, { x: 1, y: 1 }, { x: 0, y: 0 }, 0, 2)).toEqual({ x: 5, y: 6 })
  })

  it('keeps the image reachable but not flung far away', () => {
    // 内容与视口等大时，只允许 25% 视口的余量
    expect(clampMaskPan({ x: 999, y: -999 }, 800, 600, 800, 600)).toEqual({ x: 200, y: -150 })
    // 内容比视口大时，多出的部分全部可拖
    expect(clampMaskPan({ x: 999, y: 0 }, 800, 600, 1600, 600)).toEqual({ x: 600, y: 0 })
  })

  it('re-clamps a stale pan after the stage shrinks so the image stays reachable', () => {
    // 真实路径：canvas 1536，stage 从 1600x900 缩到 800x300，zoom 固定 3。
    // fitScale 会随 stage 变化，所以内容尺寸必须重新用新 fit 计算，不能用旧内容尺寸。
    const canvasW = 1536
    const canvasH = 1536
    const zoom = 3
    const bigStage = { width: 1600, height: 900 }
    const smallStage = { width: 800, height: 300 }

    const bigFit = computeMaskFitScale(bigStage.width, bigStage.height, canvasW, canvasH)
    const smallFit = computeMaskFitScale(smallStage.width, smallStage.height, canvasW, canvasH)
    // fit 变了：大窗口受高限制 900/1536，小窗口受高限制 300/1536
    expect(bigFit).toBeCloseTo(900 / 1536)
    expect(smallFit).toBeCloseTo(300 / 1536)

    const bigContent = { w: canvasW * bigFit * zoom, h: canvasH * bigFit * zoom }
    const smallContent = { w: canvasW * smallFit * zoom, h: canvasH * smallFit * zoom }
    expect(bigContent.h).toBeCloseTo(2700)
    expect(smallContent.h).toBeCloseTo(900)

    // 在大窗口里拖到允许的最右下角
    const dragged = clampMaskPan({ x: 99999, y: 99999 }, bigStage.width, bigStage.height, bigContent.w, bigContent.h)
    expect(dragged.y).toBeCloseTo((2700 - 900) / 2 + 900 * 0.25)

    // 缩窗后必须按新内容尺寸重钳：上限从 1125 降到 (900-300)/2 + 75 = 375
    const reclamped = clampMaskPan(dragged, smallStage.width, smallStage.height, smallContent.w, smallContent.h)
    expect(reclamped.y).toBeCloseTo((900 - 300) / 2 + 300 * 0.25)
    expect(reclamped.y).toBeLessThan(dragged.y)

    // 用旧内容尺寸去钳制则钳不住（这正是修复前的问题），保证测试真能区分两种实现
    const staleClamp = clampMaskPan(dragged, smallStage.width, smallStage.height, bigContent.w, bigContent.h)
    expect(staleClamp.y).toBeGreaterThan(reclamped.y)
  })

  it('pops the last stroke without mutating the source array', () => {
    const strokes: MaskStroke[] = [
      { tool: 'brush', size: 20, points: [{ x: 1, y: 1 }] },
      { tool: 'eraser', size: 20, points: [{ x: 2, y: 2 }] }
    ]

    const popped = popMaskStroke(strokes)

    expect(popped).toHaveLength(1)
    expect(popped[0].tool).toBe('brush')
    expect(strokes).toHaveLength(2)
    expect(popMaskStroke([])).toEqual([])
  })

  it('splits a stroke into consecutive segments', () => {
    const stroke: MaskStroke = {
      tool: 'brush',
      size: 10,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 }
      ]
    }

    expect(strokeSegments(stroke)).toEqual([
      [{ x: 0, y: 0 }, { x: 10, y: 0 }],
      [{ x: 10, y: 0 }, { x: 10, y: 10 }]
    ])
    expect(strokeSegments({ tool: 'brush', size: 10, points: [{ x: 0, y: 0 }] })).toEqual([])
  })

  it('drops a late image load that no longer belongs to the active reference', () => {
    const ticket = createLoadTicket('a')
    // A 发起加载，随后用户切到 B 并重新发起
    const ticketA = ticket.begin('a')
    const ticketB = ticket.begin('b')

    // A 的 onload 迟到：不能落盘
    expect(ticket.isCurrent('a', ticketA)).toBe(false)
    // B 的 onload 正常：落盘
    expect(ticket.isCurrent('b', ticketB)).toBe(true)
  })

  it('treats an older request of the same reference as stale', () => {
    const ticket = createLoadTicket('a')
    const first = ticket.begin('a')
    const second = ticket.begin('a')

    // 同一张图重复加载时，只有最后一次请求的结果算数
    expect(ticket.isCurrent('a', first)).toBe(false)
    expect(ticket.isCurrent('a', second)).toBe(true)
    expect(ticket.current()).toBe('a')
  })

  it('invalidates in-flight loads on unmount', () => {
    const ticket = createLoadTicket('a')
    const inFlight = ticket.begin('a')
    ticket.invalidate()

    expect(ticket.isCurrent('a', inFlight)).toBe(false)
    expect(ticket.current()).toBe('a')
  })
})
