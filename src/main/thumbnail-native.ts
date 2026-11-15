import { nativeImage } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  computeThumbnailSize,
  thumbnailPathFor,
  THUMBNAIL_JPEG_QUALITY,
  THUMBNAIL_MAX_EDGE
} from './thumbnail'

/**
 * 生成缩略图并写盘。任何失败（文件不存在/不是图片/解码异常/写盘失败）都返回 null，不抛错，
 * 由调用方回退到原图。缩略图已存在时直接返回其路径。
 */
export function ensureThumbnail(filePath: string, maxEdge: number = THUMBNAIL_MAX_EDGE): string | null {
  const target = thumbnailPathFor(filePath)
  if (existsSync(target)) return target
  return writeThumbnail(filePath, maxEdge)
}

export function writeThumbnail(filePath: string, maxEdge: number = THUMBNAIL_MAX_EDGE): string | null {
  try {
    if (!existsSync(filePath)) return null
    const image = nativeImage.createFromPath(filePath)
    if (image.isEmpty()) return null
    const { width, height } = image.getSize()
    const size = computeThumbnailSize(width, height, maxEdge)
    // 原图本身不超过 maxEdge，不需要缩略图，直接用原图即可。
    if (!size) return null
    const buffer = image.resize({ width: size.width, height: size.height, quality: 'good' }).toJPEG(THUMBNAIL_JPEG_QUALITY)
    if (!buffer || buffer.length === 0) return null
    const target = thumbnailPathFor(filePath)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, buffer)
    return target
  } catch {
    return null
  }
}

/**
 * 串行队列：nativeImage 解码是同步 CPU 操作，一页 30 张图同时补齐会阻塞主进程。
 * 每次生成之间用 setImmediate 让出事件循环，保证协议请求与 IPC 不被长时间饿死。
 */
let tail: Promise<unknown> = Promise.resolve()

export function enqueueThumbnail(filePath: string, maxEdge: number = THUMBNAIL_MAX_EDGE): Promise<string | null> {
  const next = tail.then(
    () => new Promise<string | null>((resolve) => {
      setImmediate(() => resolve(ensureThumbnail(filePath, maxEdge)))
    })
  )
  tail = next.catch(() => undefined)
  return next
}
