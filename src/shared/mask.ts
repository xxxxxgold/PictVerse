/**
 * 遮罩（mask）相关的纯计算，main / renderer 共用。
 *
 * 上游 images/edits 的两条硬约束：
 * 1. mask 必须与原图同尺寸；
 * 2. mask 像素的 alpha 只能是 0（重绘）或 255（保留），涂抹层的半透明边缘会被拒绝或忽略。
 */

export type MaskSize = { width: number; height: number }

/** mask 输出尺寸跟着参考图原始尺寸走；取不到自然尺寸时回退到编辑器画布尺寸 */
export function resolveMaskOutputSize(
  naturalWidth: number,
  naturalHeight: number,
  fallbackWidth: number,
  fallbackHeight: number
): MaskSize {
  const width = Math.round(naturalWidth > 0 ? naturalWidth : fallbackWidth)
  const height = Math.round(naturalHeight > 0 ? naturalHeight : fallbackHeight)
  return { width: Math.max(1, width), height: Math.max(1, height) }
}

/**
 * 涂抹层 RGBA → 遮罩 RGBA。
 * 涂抹过的像素输出 alpha = 0（需要重绘），没涂抹的像素输出 alpha = 255（保留原图）。
 */
export function buildMaskPixels(stroke: Uint8ClampedArray): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(stroke.length)
  for (let index = 0; index < stroke.length; index += 4) {
    const painted = stroke[index + 3] > 0
    mask[index] = 255
    mask[index + 1] = 255
    mask[index + 2] = 255
    mask[index + 3] = painted ? 0 : 255
  }
  return mask
}

/**
 * 把带遮罩的参考图排到第一位。
 * images/edits 只对第一张 image 应用 mask，顺序不对就会把遮罩套在别的图上。
 */
export function moveMaskReferenceFirst<T extends { id: string }>(
  references: T[],
  maskReferenceId?: string | null
): T[] {
  if (!maskReferenceId) return references
  const index = references.findIndex((reference) => reference.id === maskReferenceId)
  if (index <= 0) return references
  return [references[index], ...references.slice(0, index), ...references.slice(index + 1)]
}

/** 同 moveMaskReferenceFirst，输入输出都是 id 列表 */
export function orderReferenceIdsForMask(
  referenceIds: string[],
  maskReferenceId?: string | null
): string[] {
  return moveMaskReferenceFirst(referenceIds.map((id) => ({ id })), maskReferenceId).map((item) => item.id)
}
