import { describe, expect, it } from 'vitest'
import { isPathInside } from './path-guard'
import { join, resolve } from 'node:path'

describe('isPathInside', () => {
  const root = resolve('D:\\data\\images')

  it('allows direct child', () => {
    expect(isPathInside(root, join(root, 'a.png'))).toBe(true)
    expect(isPathInside(root, join(root, 'session-x', 'b.png'))).toBe(true)
  })

  it('rejects the root itself', () => {
    expect(isPathInside(root, root)).toBe(false)
  })

  it('rejects sibling directory with shared prefix', () => {
    // B1 回归：startsWith 陷阱
    expect(isPathInside(root, resolve('D:\\data\\images-backup\\a.png'))).toBe(false)
  })

  it('rejects unrelated paths and parent paths', () => {
    expect(isPathInside(root, resolve('D:\\other\\a.png'))).toBe(false)
    expect(isPathInside(root, resolve('D:\\data'))).toBe(false)
  })

  it('is case-insensitive on win32', () => {
    expect(isPathInside(root, resolve('d:\\DATA\\IMAGES\\a.PNG'))).toBe(true)
  })

  it('rejects relative escape segments', () => {
    expect(isPathInside(root, join(root, '..', 'evil.png'))).toBe(false)
  })
})
