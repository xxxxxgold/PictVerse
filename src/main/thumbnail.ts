/**
 * 缩略图纯函数：路径规则与目标尺寸计算。
 * 刻意不依赖 electron，便于在 node 环境下单测。
 * 真正调用 nativeImage 的实现放在 thumbnail-native.ts。
 */

export const THUMBNAIL_MAX_EDGE = 512
export const THUMBNAIL_SUFFIX = '.thumb.jpg'
export const THUMBNAIL_JPEG_QUALITY = 82

export type ThumbnailSize = { width: number; height: number }

/**
 * 缩略图与原图同目录，追加后缀而不是替换扩展名：
 * 原图可能是 xxx.png / xxx.jpg / xxx.gif，替换扩展名会与同 id 的其他格式撞名。
 */
export function thumbnailPathFor(filePath: string): string {
  return `${filePath}${THUMBNAIL_SUFFIX}`
}

export function isThumbnailPath(filePath: string): boolean {
  return filePath.endsWith(THUMBNAIL_SUFFIX)
}

/**
 * 一张原图对应的全部磁盘产物（原图 + 缩略图）。
 * 删除历史项时按这个清单清理，避免留下孤儿缩略图。
 */
export function derivedImagePaths(filePath: string): string[] {
  return [filePath, thumbnailPathFor(filePath)]
}

/**
 * 等比缩放到最长边 maxEdge，不放大。
 * 原图最长边已不超过 maxEdge 时返回 null（表示无需生成缩略图）。
 */
export function computeThumbnailSize(
  width: number,
  height: number,
  maxEdge: number = THUMBNAIL_MAX_EDGE
): ThumbnailSize | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  if (width <= 0 || height <= 0) return null
  if (!Number.isFinite(maxEdge) || maxEdge <= 0) return null
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return null
  const scale = maxEdge / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  }
}
