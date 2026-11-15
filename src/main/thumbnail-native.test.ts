import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// nativeImage 由 electron 提供，node 测试环境没有；用内存里的 1x1 PNG 冒充足够判断调用的假实现。
const resizeCalls: Array<{ width: number; height: number; quality: string }> = []
let imageState: { empty: boolean; width: number; height: number; throws?: boolean } = { empty: false, width: 1024, height: 1024 }

vi.mock('electron', () => ({
  nativeImage: {
    createFromPath: () => {
      if (imageState.throws) throw new Error('nativeImage decode failed')
      return {
        isEmpty: () => imageState.empty,
        getSize: () => ({ width: imageState.width, height: imageState.height }),
        resize: (options: { width: number; height: number; quality: string }) => {
          resizeCalls.push(options)
          return { toJPEG: () => Buffer.from('thumb-bytes') }
        }
      }
    }
  }
}))

import { ensureThumbnail, writeThumbnail } from './thumbnail-native'
import { thumbnailPathFor } from './thumbnail'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pictverse-thumb-'))
  resizeCalls.length = 0
  imageState = { empty: false, width: 1024, height: 1024 }
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function writeFakeImage(name = 'a.png'): string {
  const filePath = join(dir, name)
  writeFileSync(filePath, 'fake-image-bytes')
  return filePath
}

describe('writeThumbnail', () => {
  it('生成缩略图并返回同目录路径', () => {
    const original = writeFakeImage()
    const target = writeThumbnail(original, 512)
    expect(target).toBe(thumbnailPathFor(original))
    expect(target).not.toBeNull()
  })

  it('按最长边等比缩放', () => {
    imageState = { empty: false, width: 3840, height: 2161 }
    writeThumbnail(writeFakeImage(), 512)
    expect(resizeCalls).toEqual([{ width: 512, height: 288, quality: 'good' }])
  })

  it('文件不存在时返回 null 且不抛错', () => {
    expect(() => writeThumbnail(join(dir, 'missing.png'), 512)).not.toThrow()
    expect(writeThumbnail(join(dir, 'missing.png'), 512)).toBeNull()
  })

  it('不是图片（nativeImage 解码为空）时返回 null 且不抛错', () => {
    imageState = { empty: true, width: 0, height: 0 }
    expect(writeThumbnail(writeFakeImage(), 512)).toBeNull()
  })

  it('原图不超过 maxEdge 时不生成，返回 null', () => {
    imageState = { empty: false, width: 200, height: 200 }
    expect(writeThumbnail(writeFakeImage(), 512)).toBeNull()
    expect(resizeCalls).toHaveLength(0)
  })

  it('nativeImage 解码抛错时返回 null 不抛错（协议层可回退原图）', () => {
    imageState = { empty: false, width: 1024, height: 1024, throws: true }
    const original = writeFakeImage()
    expect(() => writeThumbnail(original, 512)).not.toThrow()
    expect(writeThumbnail(original, 512)).toBeNull()
  })
})

describe('ensureThumbnail', () => {
  it('缩略图不存在时生成', () => {
    const original = writeFakeImage()
    expect(ensureThumbnail(original, 512)).toBe(thumbnailPathFor(original))
  })

  it('缩略图已存在时直接复用，不重复解码', () => {
    const original = writeFakeImage()
    ensureThumbnail(original, 512)
    resizeCalls.length = 0
    expect(ensureThumbnail(original, 512)).toBe(thumbnailPathFor(original))
    expect(resizeCalls).toHaveLength(0)
  })
})
