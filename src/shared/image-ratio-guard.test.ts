import { describe, expect, it } from 'vitest'
import { getDefaultImageSize, getImageSizeOptions, normalizeImageRatio, ratioToSize } from './image-options'

/**
 * 回归：脏比例不能让读取链路抛错。
 * 历史版本 / 手改 DB 可能存下不在枚举里的 ratio，
 * 之前 getImageSizeOptions 直接返回 undefined，getDefaultImageSize 随即抛 TypeError，
 * 导致整条「读取会话列表」失败。
 */
describe('dirty image ratio', () => {
  it('falls back to the 1:1 size table for an unknown ratio', () => {
    const options = getImageSizeOptions('9:99' as never)
    expect(Array.isArray(options)).toBe(true)
    expect(options.length).toBeGreaterThan(0)
  })

  it('returns a usable default size instead of throwing', () => {
    expect(() => getDefaultImageSize('9:99' as never)).not.toThrow()
    expect(getDefaultImageSize('9:99' as never)).toBe(getDefaultImageSize('1:1'))
  })

  it('falls back to the 1:1 entry when the ratio map has no such key', () => {
    expect(ratioToSize('nope' as never)).toBe('1024x1024')
  })

  it('keeps every legal ratio untouched', () => {
    expect(normalizeImageRatio('16:9')).toBe('16:9')
    expect(normalizeImageRatio('9:21')).toBe('9:21')
    expect(getDefaultImageSize('16:9')).toBe('1792x1008')
  })

  it('normalizes non-string and unknown values to 1:1', () => {
    expect(normalizeImageRatio(null)).toBe('1:1')
    expect(normalizeImageRatio(undefined)).toBe('1:1')
    expect(normalizeImageRatio(16)).toBe('1:1')
    expect(normalizeImageRatio('')).toBe('1:1')
  })
})
