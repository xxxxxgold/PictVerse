import { describe, expect, it } from 'vitest'
import { buildMaskPixels, moveMaskReferenceFirst, orderReferenceIdsForMask, resolveMaskOutputSize } from './mask'

describe('mask helpers', () => {
  it('keeps the mask at the source image size instead of the editor canvas size', () => {
    expect(resolveMaskOutputSize(1024, 1024, 768, 768)).toEqual({ width: 1024, height: 1024 })
  })

  it('falls back to the canvas size when the natural size is unknown', () => {
    expect(resolveMaskOutputSize(0, 0, 640, 480)).toEqual({ width: 640, height: 480 })
  })

  it('never returns a zero or fractional size', () => {
    expect(resolveMaskOutputSize(1024.4, 0.2, 0, 0)).toEqual({ width: 1024, height: 1 })
  })

  it('turns painted pixels transparent and keeps the rest opaque white', () => {
    const stroke = new Uint8ClampedArray([
      79, 214, 168, 255, // painted
      79, 214, 168, 12, // anti-aliased edge, still painted
      0, 0, 0, 0 // untouched
    ])

    const mask = buildMaskPixels(stroke)

    expect(Array.from(mask.slice(0, 4))).toEqual([255, 255, 255, 0])
    expect(Array.from(mask.slice(4, 8))).toEqual([255, 255, 255, 0])
    expect(Array.from(mask.slice(8, 12))).toEqual([255, 255, 255, 255])
  })

  it('binarizes every alpha so the upstream never sees a半透明 mask', () => {
    const stroke = new Uint8ClampedArray(16)
    const mask = buildMaskPixels(stroke)

    for (let index = 3; index < mask.length; index += 4) {
      expect([0, 255]).toContain(mask[index])
    }
  })

  it('moves the masked reference to the front so the upstream applies the mask to the right image', () => {
    const references = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

    expect(moveMaskReferenceFirst(references, 'c').map((item) => item.id)).toEqual(['c', 'a', 'b'])
    expect(moveMaskReferenceFirst(references, 'a').map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(moveMaskReferenceFirst(references, 'missing').map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(moveMaskReferenceFirst(references, null).map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(orderReferenceIdsForMask(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
  })
})
