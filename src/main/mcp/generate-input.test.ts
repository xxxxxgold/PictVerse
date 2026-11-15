import { describe, expect, it } from 'vitest'
import type { Conversation } from '@shared/types'
import { buildGenerateInput } from './generate-input'

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    title: '测试会话',
    draftPrompt: '一只在雨里奔跑的猫',
    model: 'gpt-image-2.6',
    providerId: null,
    ratio: '1:1',
    size: '1024x1024',
    quality: 'high',
    n: 1,
    outputFormat: 'png',
    outputCompression: null,
    background: 'auto',
    moderation: 'auto',
    stream: false,
    partialImages: null,
    inputFidelity: null,
    complexity: null,
    frameCount: null,
    frameDurationMs: null,
    seed: null,
    seedLocked: false,
    autoSaveHistory: true,
    keepFailureDetails: true,
    referenceImages: [],
    createdAt: '2026-11-15T00:00:00.000Z',
    updatedAt: '2026-11-15T00:00:00.000Z',
    ...overrides
  }
}

describe('生成参数收敛', () => {
  it('默认沿用会话参数与草稿词', () => {
    const result = buildGenerateInput(makeConversation(), {})
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.input).toMatchObject({
      conversationId: 'conv-1',
      prompt: '一只在雨里奔跑的猫',
      model: 'gpt-image-2.6',
      ratio: '1:1',
      size: '1024x1024',
      quality: 'high',
      n: 1,
      outputFormat: 'png'
    })
  })

  it('空提示词直接拒绝，不生成请求', () => {
    const result = buildGenerateInput(makeConversation({ draftPrompt: '   ' }), {})
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('prompt')
  })

  it('覆盖参数的优先级高于会话', () => {
    const result = buildGenerateInput(makeConversation(), {
      prompt: '新提示词',
      ratio: '16:9',
      quality: 'max',
      n: 3,
      outputFormat: 'webp'
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.input.prompt).toBe('新提示词')
    expect(result.input.ratio).toBe('16:9')
    // 比例变了但没给尺寸：回落到该比例的标准档，而不是沿用 1:1 的尺寸
    expect(result.input.size).toBe('1792x1008')
    expect(result.input.quality).toBe('max')
    expect(result.input.n).toBe(3)
    expect(result.input.outputFormat).toBe('webp')
  })

  it('不支持的模型能力回落到安全默认值', () => {
    // gpt-image-2 只有四档质量、没有 svg / gif、没有透明背景
    const result = buildGenerateInput(makeConversation({ model: 'gpt-image-2' }), {
      quality: 'max',
      outputFormat: 'gif',
      background: 'transparent'
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.input.quality).toBe('high')
    expect(result.input.outputFormat).toBe('png')
    expect(result.input.background).toBe('auto')
  })

  it('尺寸与比例不匹配时回退到标准档', () => {
    const result = buildGenerateInput(makeConversation(), { ratio: '9:16', size: '1024x1024' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.input.size).toBe('1008x1792')
  })

  it('张数被夹在 1–10，参考图去重后最多 8 张', () => {
    const result = buildGenerateInput(makeConversation(), {
      n: 99,
      referenceImageIds: ['a', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.input.n).toBe(10)
    expect(result.input.referenceImageIds).toHaveLength(8)
  })

  it('会话锁定的 seed 会带上，未锁定则不带', () => {
    const locked = buildGenerateInput(makeConversation({ seed: 42, seedLocked: true }), {})
    expect(locked.ok && locked.input.seed).toBe(42)

    const unlocked = buildGenerateInput(makeConversation({ seed: 42, seedLocked: false }), {})
    expect(unlocked.ok && unlocked.input.seed).toBeUndefined()
  })
})
