/**
 * 遮罩编辑器的缩放 / 平移 / 笔画几何计算，纯函数，便于单测。
 *
 * 关键约定：缩放走 CSS transform，不改 canvas 内部坐标系。
 * 因此绘制落点仍用 getBoundingClientRect()（它会反映祖先 transform 后的真实尺寸）换算，
 * 这里只负责算出 transform 需要的 scale 与 pan。
 */

export type MaskPan = { x: number; y: number }

export type MaskStrokePoint = { x: number; y: number }

/** 画笔或橡皮的一笔；points 是画布内部像素坐标 */
export type MaskStroke = {
  tool: 'brush' | 'eraser'
  size: number
  points: MaskStrokePoint[]
}

export const MASK_MIN_ZOOM = 0.5
export const MASK_MAX_ZOOM = 3
export const MASK_WHEEL_STEP = 0.2
/** 编辑画布内部最大边长：放大精修需要像素，但太大吃内存 */
export const MASK_CANVAS_MAX = 1536

export function clampMaskZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1
  return Math.min(MASK_MAX_ZOOM, Math.max(MASK_MIN_ZOOM, zoom))
}

export function getMaskZoomAfterWheel(zoom: number, deltaY: number): number {
  const direction = deltaY > 0 ? -1 : 1
  return clampMaskZoom(zoom + direction * MASK_WHEEL_STEP)
}

export function formatMaskZoom(zoom: number): string {
  return `${Math.round(zoom * 100)}%`
}

/**
 * fit 比例：画布刚好装进可视区时的 CSS 尺寸系数。
 * 100% 指的是这个 fit 比例，而不是 1 个画布像素对 1 个 CSS 像素——
 * 参考图常有 1024/1536，若 100% 是 1:1，打开就超出可视区，得先拖才能看全。
 */
export function computeMaskFitScale(
  stageWidth: number,
  stageHeight: number,
  canvasWidth: number,
  canvasHeight: number
): number {
  if (stageWidth <= 0 || stageHeight <= 0 || canvasWidth <= 0 || canvasHeight <= 0) return 1
  return Math.min(stageWidth / canvasWidth, stageHeight / canvasHeight)
}

/** 画布内部尺寸：按原图比例缩到 MASK_CANVAS_MAX 以内，不放大超过原图 */
export function resolveMaskCanvasSize(
  naturalWidth: number,
  naturalHeight: number,
  max = MASK_CANVAS_MAX
): { width: number; height: number } {
  const width = Math.max(1, Math.round(naturalWidth))
  const height = Math.max(1, Math.round(naturalHeight))
  const scale = Math.min(1, max / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  }
}

/**
 * 缩放时以光标为锚点：让光标下的图像点保持不动。
 *
 * 推导：图像坐标 p 在屏幕上的位置 = center + pan + (p - centerImage) * scale。
 * 要求缩放前后 p 的屏幕位置不变，得到
 *   pan' = (cursor - center) - (cursor - center - pan) * (scale' / scale)
 * 其中 center 是 stage 中心，scale 为 fitScale × zoom。
 */
export function computeZoomAnchoredPan(
  pan: MaskPan,
  cursor: MaskStrokePoint,
  stageCenter: MaskStrokePoint,
  scale: number,
  nextScale: number
): MaskPan {
  if (!(scale > 0) || !(nextScale > 0)) return pan
  const ratio = nextScale / scale
  const dx = cursor.x - stageCenter.x
  const dy = cursor.y - stageCenter.y
  return {
    x: dx - (dx - pan.x) * ratio,
    y: dy - (dy - pan.y) * ratio
  }
}

/** 放大后允许平移，但别让图片被拖出可视区太远；留 25% 余量便于贴边涂抹 */
export function clampMaskPan(
  pan: MaskPan,
  stageWidth: number,
  stageHeight: number,
  contentWidth: number,
  contentHeight: number
): MaskPan {
  const limitX = Math.max(0, (contentWidth - stageWidth) / 2) + stageWidth * 0.25
  const limitY = Math.max(0, (contentHeight - stageHeight) / 2) + stageHeight * 0.25
  return {
    x: Math.min(limitX, Math.max(-limitX, pan.x)),
    y: Math.min(limitY, Math.max(-limitY, pan.y))
  }
}

/** 撤销栈里最后一笔之后的状态：返回去掉末笔的新数组（不改原数组） */
export function popMaskStroke(strokes: MaskStroke[]): MaskStroke[] {
  return strokes.length ? strokes.slice(0, -1) : strokes
}

/**
 * 一笔里的线段：把点列拆成相邻点对。
 * 实时绘制只补最后一段，避免每帧全量重绘导致长笔画掉帧。
 */
export function strokeSegments(stroke: MaskStroke): Array<[MaskStrokePoint, MaskStrokePoint]> {
  const segments: Array<[MaskStrokePoint, MaskStrokePoint]> = []
  for (let index = 1; index < stroke.points.length; index += 1) {
    segments.push([stroke.points[index - 1], stroke.points[index]])
  }
  return segments
}

/**
 * 参考图异步加载的归属守卫。
 * A 慢、B 快时，A 的 onload 会迟到；迟到回调若照常写画布，
 * 画面与导出尺寸会来自 A，而 referenceId 仍指向 B。
 * 用法：加载时拿到 ticket，回调里用 isCurrent 判断是否还该落盘。
 */
export function createLoadTicket(initialId: string): {
  current: () => string
  begin: (id: string) => number
  isCurrent: (id: string, ticket: number) => boolean
  invalidate: () => void
} {
  let currentId = initialId
  let latestTicket = 0
  return {
    current: () => currentId,
    /** 发起一次加载：切换归属并返回本次票号 */
    begin: (id: string) => {
      currentId = id
      latestTicket += 1
      return latestTicket
    },
    /** 让所有在途请求作废（卸载或切图时用），不改当前归属 */
    invalidate: () => {
      latestTicket += 1
    },
    isCurrent: (id: string, ticket: number) => currentId === id && ticket === latestTicket
  }
}
