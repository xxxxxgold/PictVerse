import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  PROMPT_LIBRARY_STORAGE_KEY,
  PROMPT_TEMPLATE_ANY_MODEL,
  clonePromptTemplate,
  createEmptyPromptTemplateInput,
  createPromptLibraryItem,
  deletePromptLibraryItem,
  filterPromptTemplates,
  getPromptLibraryItems,
  getPromptTemplateCategories,
  getPromptTemplateModels,
  PROMPT_TEMPLATES,
  updatePromptLibraryItem
} from './prompt-library'

describe('prompt library', () => {
  const originalWindow = globalThis.window

  beforeEach(() => {
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: createLocalStorageMock()
      },
      configurable: true
    })
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true
    })
  })

  it('seeds builtin templates into local storage on first access', () => {
    window.localStorage.clear()

    const items = getPromptLibraryItems()

    expect(items).toHaveLength(PROMPT_TEMPLATES.length)
    expect(items[0].prompt).toContain('奢华腕表广告海报')
  })

  it('returns sorted unique categories', () => {
    expect(getPromptTemplateCategories(PROMPT_TEMPLATES)).toEqual([
      '商业海报',
      '产品摄影',
      '人物肖像',
      '时尚编辑',
      '运动广告',
      '故事板',
      '贴纸包',
      '信息图',
      '空间设计',
      '食物摄影',
      '电影封面',
      'UI 视觉',
      '角色设计'
    ])
  })

  it('filters by query, category, ratio and quality', () => {
    expect(filterPromptTemplates(PROMPT_TEMPLATES, { query: '贴纸' }).map((template) => template.id)).toEqual(['sticker-sheet'])
    expect(filterPromptTemplates(PROMPT_TEMPLATES, { category: '产品摄影', ratio: '4:3' }).map((template) => template.id)).toEqual(['minimal-product-shot'])
    expect(filterPromptTemplates(PROMPT_TEMPLATES, { quality: 'medium' }).map((template) => template.id)).toEqual([
      'storyboard-grid',
      'infographic-product',
      'glass-ui-card',
      'snack-teardown-infographic',
      'notion-desk-illustration',
      'ios-photos-mockup',
      'character-card-knight',
      'character-card-assassin',
      'character-card-medic',
      'character-card-qipao',
      'felted-lockscreen'
    ])
  })

  it('keeps prompt text and resolution together', () => {
    const template = PROMPT_TEMPLATES[0]
    expect(template.prompt).toContain('奢华腕表广告海报')
    expect(template.resolution).toBe('1024x1024')
  })

  it('filters by model and treats empty model as follow-conversation', () => {
    const templates = [
      { ...PROMPT_TEMPLATES[0], id: 'pinned', model: 'qwen-image-2.1' },
      { ...PROMPT_TEMPLATES[1], id: 'follow', model: '' }
    ]

    expect(filterPromptTemplates(templates, { model: 'qwen-image-2.1' }).map((item) => item.id)).toEqual(['pinned'])
    expect(filterPromptTemplates(templates, { model: PROMPT_TEMPLATE_ANY_MODEL }).map((item) => item.id)).toEqual(['follow'])
    expect(filterPromptTemplates(templates, { model: 'all' }).map((item) => item.id)).toEqual(['pinned', 'follow'])
  })

  it('collects model choices and matches them in search', () => {
    const templates = [
      { ...PROMPT_TEMPLATES[0], model: 'qwen-image-2.1' },
      { ...PROMPT_TEMPLATES[1], model: 'qwen-image-2.1' },
      { ...PROMPT_TEMPLATES[2], model: '' }
    ]

    expect(getPromptTemplateModels(templates)).toEqual(['qwen-image-2.1'])
    expect(filterPromptTemplates(templates, { query: 'qwen-image-2.1' })).toHaveLength(2)
  })

  it('defaults new templates to follow-conversation and keeps model through clone', () => {
    expect(createEmptyPromptTemplateInput().model).toBe('')
    expect(clonePromptTemplate({ ...PROMPT_TEMPLATES[0], model: 'moss' }).model).toBe('moss')
  })

  it('supports create update and delete operations for templates', () => {
    window.localStorage.clear()
    getPromptLibraryItems()

    const created = createPromptLibraryItem({
      ...createEmptyPromptTemplateInput(),
      title: '自定义模板',
      category: '测试分类',
      description: '',
      prompt: '中文提示词',
      tags: ['测试'],
      ratio: '1:1',
      resolution: '1024x1024',
      quality: 'high'
    })
    expect(created.prompt).toBe('中文提示词')
    expect(created.description).toBe('')
    expect(getPromptLibraryItems().some((item) => item.id === created.id)).toBe(true)

    const builtin = getPromptLibraryItems().find((item) => item.id === 'sticker-sheet')
    expect(builtin).toBeTruthy()
    const updated = updatePromptLibraryItem('sticker-sheet', {
      ...clonePromptTemplate(builtin!),
      title: '贴纸包（已更新）'
    })
    expect(updated.title).toBe('贴纸包（已更新）')

    deletePromptLibraryItem(created.id)
    expect(getPromptLibraryItems().some((item) => item.id === created.id)).toBe(false)
  })

  it('merges missing builtin templates for users on an older seed version', () => {
    window.localStorage.clear()
    // 模拟老用户：库里只有第一版 12 条内置模板 + 一条自建，且种子版本标记为 1
    const legacy = PROMPT_TEMPLATES.filter((template) => !template.id.includes('infographic') || template.id === 'infographic-product')
    const first12 = PROMPT_TEMPLATES.slice(0, 12)
    void legacy
    window.localStorage.setItem(PROMPT_LIBRARY_STORAGE_KEY, JSON.stringify(first12))
    window.localStorage.setItem('pictverse.prompt-library.seed-version', '1')

    const items = getPromptLibraryItems()

    // 16 条新增内置模板被补齐，且不重复
    const ids = items.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const builtin of PROMPT_TEMPLATES) {
      expect(ids).toContain(builtin.id)
    }
    // 种子版本被推进到当前值，再次读取不会再变
    expect(window.localStorage.getItem('pictverse.prompt-library.seed-version')).toBe('2')
    const again = getPromptLibraryItems()
    expect(again.map((item) => item.id)).toEqual(ids)
  })
})

function createLocalStorageMock(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    clear: () => {
      store.clear()
    },
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key)
    },
    setItem: (key: string, value: string) => {
      store.set(key, value)
    }
  } as Storage
}
