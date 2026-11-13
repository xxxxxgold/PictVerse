import { describe, expect, it } from 'vitest'
import { conversationDirName } from './conversation-dir'

describe('conversationDirName', () => {
  const base = { createdAt: '2026-11-13T08:30:00.000Z', id: 'a3f2c1d8-1234-5678-90ab-cdef01234567' }

  it('builds date_title_shortid in local time', () => {
    // UTC 08:30 在东八区是 16:30，同一天
    expect(conversationDirName({ ...base, title: '三国外传' })).toBe('2026-11-13_三国外传_a3f2c1d8')
  })

  it('crosses local date boundary for early-morning UTC timestamps', () => {
    // UTC 2026-11-12 17:00 → 东八区 2026-11-13 01:00
    expect(conversationDirName({ ...base, createdAt: '2026-11-12T17:00:00.000Z', title: '夜聊' })).toBe(
      '2026-11-13_夜聊_a3f2c1d8'
    )
  })

  it('sanitizes Windows-illegal characters', () => {
    expect(conversationDirName({ ...base, title: 'a<b>c:d"e/f\\g|h?i*j' })).toBe(
      '2026-11-13_a_b_c_d_e_f_g_h_i_j_a3f2c1d8'
    )
  })

  it('strips control characters and trailing dots/spaces', () => {
    expect(conversationDirName({ ...base, title: '  名字.. \u0007 ' })).toBe('2026-11-13_名字_a3f2c1d8')
  })

  it('falls back to 未命名 for empty titles', () => {
    expect(conversationDirName({ ...base, title: '' })).toBe('2026-11-13_未命名_a3f2c1d8')
    expect(conversationDirName({ ...base, title: '   ' })).toBe('2026-11-13_未命名_a3f2c1d8')
  })

  it('caps the title at 40 characters', () => {
    const long = '甲'.repeat(60)
    const name = conversationDirName({ ...base, title: long })
    expect(name.startsWith('2026-11-13_')).toBe(true)
    expect(name.endsWith('_a3f2c1d8')).toBe(true)
    expect(name.slice('2026-11-13_'.length, -'_a3f2c1d8'.length).length).toBeLessThanOrEqual(40)
  })

  it('does not split surrogate pairs when capping', () => {
    // 39 个 ASCII + 1 个 emoji（2 码元）：按码元截断会产生孤立代理对
    const title = 'a'.repeat(39) + '😀'
    const name = conversationDirName({ ...base, title })
    const inner = name.slice('2026-11-13_'.length, -'_a3f2c1d8'.length)
    expect(Array.from(inner).length).toBeLessThanOrEqual(40)
    // 不含孤立高位代理
    expect(/[\uD800-\uDBFF]$/.test(inner)).toBe(false)
    expect(inner.endsWith('😀') || inner.endsWith('a')).toBe(true)
  })

  it('handles invalid dates', () => {
    expect(conversationDirName({ ...base, createdAt: 'not-a-date', title: 'x' })).toBe('unknown-date_x_a3f2c1d8')
  })
})
