import { describe, expect, it } from 'vitest'
import {
  canCreateEditableOption,
  filterEditableOptionsForQuery,
  normalizeEditableOptions,
  toggleEditableMultiValue
} from './EditableSelect'

describe('editable select helpers', () => {
  it('only recommends creating an option when input is non-empty and no candidate matches', () => {
    const options = normalizeEditableOptions(['商业海报', '人物肖像'])

    expect(canCreateEditableOption('', options, true)).toBe(false)
    expect(canCreateEditableOption('商业海报', options, true)).toBe(false)
    expect(canCreateEditableOption(' 商业海报 ', options, true)).toBe(false)
    expect(canCreateEditableOption('商业', options, true)).toBe(false)
    expect(canCreateEditableOption('新分类', options, true)).toBe(true)
    expect(canCreateEditableOption('新分类', options, false)).toBe(false)
  })

  it('does not recommend creating when the input already matches candidate text partially', () => {
    const options = normalizeEditableOptions(['表情包', '角色贴纸'])

    expect(canCreateEditableOption('表情', options, true)).toBe(false)
    expect(canCreateEditableOption('贴纸', options, true)).toBe(false)
    expect(canCreateEditableOption('美食', options, true)).toBe(true)
  })

  it('normalizes string options and removes empty duplicates', () => {
    expect(normalizeEditableOptions(['广告', '广告', ' ', '肖像'])).toEqual([
      { value: '广告', label: '广告' },
      { value: '肖像', label: '肖像' }
    ])
  })

  it('toggles multi values without duplicate case-insensitive entries', () => {
    expect(toggleEditableMultiValue(['广告'], '肖像')).toEqual(['广告', '肖像'])
    expect(toggleEditableMultiValue(['广告', '肖像'], '广告')).toEqual(['肖像'])
    expect(toggleEditableMultiValue(['广告'], ' 广告 ')).toEqual([])
  })

  it('shows every candidate when the box is not being searched', () => {
    // 聚焦时输入框里是已选中的值，不能拿它过滤，否则「获取到 5 个模型只显示 1 个」
    const options = normalizeEditableOptions(['gpt-6.1-sol', 'gpt-6.1-luna', 'gpt-5.5', 'o4-mini', 'claude-sonnet'])
    expect(filterEditableOptionsForQuery(options, 'gpt-6.1-sol', false)).toHaveLength(5)
    // 真正输入后才收窄
    expect(filterEditableOptionsForQuery(options, 'gpt-6.1', true).map((o) => o.value)).toEqual(['gpt-6.1-sol', 'gpt-6.1-luna'])
    expect(filterEditableOptionsForQuery(options, 'gpt-6.1-sol', true).map((o) => o.value)).toEqual(['gpt-6.1-sol'])
  })

  it('keeps the selected option visible in the unfiltered list', () => {
    // 未搜索时列表完整，当前选中项一定在里面（否则用户看不到自己的选择）
    const options = normalizeEditableOptions(['gpt-6.1-sol', 'gpt-6.1-luna', 'gpt-5.5'])
    const shown = filterEditableOptionsForQuery(options, 'gpt-5.5', false)
    expect(shown.map((o) => o.value)).toContain('gpt-5.5')
    expect(shown).toHaveLength(3)
  })
})
