import { isAbsolute, relative, sep } from 'node:path'

/**
 * 判定 target 是否真实位于 root 内部（不等于 root 本身）。
 * 基于 path.relative 判定，避免 startsWith 的前缀陷阱
 * （如 D:\data\images-backup 会命中 D:\data\images 前缀）；
 * win32 下 relative 对盘符与大小写不敏感。
 */
export function isPathInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  if (rel === '' || isAbsolute(rel)) return false
  // 首段为 ".." 即为父目录逃逸（含 rel === '..' 本身与 ..\sibling）
  return rel.split(sep)[0] !== '..'
}
