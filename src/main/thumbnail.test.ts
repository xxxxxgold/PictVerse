import { describe, expect, it } from 'vitest'
import { computeThumbnailSize, derivedImagePaths, isThumbnailPath, thumbnailPathFor, THUMBNAIL_MAX_EDGE } from './thumbnail'

describe('thumbnailPathFor', () => {
  it('在原图路径后追加后缀，保留原扩展名', () => {
    expect(thumbnailPathFor('D:/data/images/a.png')).toBe('D:/data/images/a.png.thumb.jpg')
    expect(thumbnailPathFor('D:/data/images/a.gif')).toBe('D:/data/images/a.gif.thumb.jpg')
  })

  it('不改变目录层级，缩略图与原图同目录', () => {
    const original = 'D:/data/images/2026-11-13_会话_ab12/uuid.png'
    expect(thumbnailPathFor(original).startsWith('D:/data/images/2026-11-13_会话_ab12/')).toBe(true)
  })

  it('isThumbnailPath 能识别缩略图', () => {
    expect(isThumbnailPath(thumbnailPathFor('a.png'))).toBe(true)
    expect(isThumbnailPath('a.png')).toBe(false)
  })
})

describe('derivedImagePaths', () => {
  it('返回原图与缩略图两项，顺序为原图在前', () => {
    const original = 'D:/data/images/s/a.png'
    expect(derivedImagePaths(original)).toEqual([original, 'D:/data/images/s/a.png.thumb.jpg'])
  })

  it('两项都落在原图所在目录内（删除守卫可覆盖）', () => {
    const original = 'D:/data/images/s/a.png'
    for (const path of derivedImagePaths(original)) {
      expect(path.startsWith('D:/data/images/s/')).toBe(true)
    }
  })
})

describe('computeThumbnailSize', () => {
  it('4K 横图按最长边缩到 512', () => {
    expect(computeThumbnailSize(3840, 2161)).toEqual({ width: 512, height: 288 })
  })

  it('4K 竖图按高边缩到 512', () => {
    expect(computeThumbnailSize(2161, 3840)).toEqual({ width: 288, height: 512 })
  })

  it('1024 方图缩到 512x512', () => {
    expect(computeThumbnailSize(1024, 1024)).toEqual({ width: 512, height: 512 })
  })

  it('小图不放大，返回 null', () => {
    expect(computeThumbnailSize(200, 200)).toBeNull()
    expect(computeThumbnailSize(THUMBNAIL_MAX_EDGE, THUMBNAIL_MAX_EDGE)).toBeNull()
  })

  it('极端长宽比至少保留 1px', () => {
    const size = computeThumbnailSize(4000, 3)
    expect(size).not.toBeNull()
    expect(size!.width).toBe(512)
    expect(size!.height).toBeGreaterThanOrEqual(1)
  })

  it('非法输入返回 null', () => {
    expect(computeThumbnailSize(0, 100)).toBeNull()
    expect(computeThumbnailSize(-1, 100)).toBeNull()
    expect(computeThumbnailSize(Number.NaN, 100)).toBeNull()
    expect(computeThumbnailSize(100, 100, 0)).toBeNull()
  })

  it('自定义 maxEdge 生效', () => {
    expect(computeThumbnailSize(1000, 500, 100)).toEqual({ width: 100, height: 50 })
  })
})
