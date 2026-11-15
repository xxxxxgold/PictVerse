import { describe, expect, it } from 'vitest'
import type { Provider } from '@shared/types'
import { toPublicConversation, toPublicHistory, toPublicProvider } from './dto'

const provider: Provider = {
  id: 'p1',
  name: '中转站',
  baseURL: 'https://api.example.com',
  apiKey: 'sk-super-secret',
  defaultModel: 'gpt-image-2.6',
  promptModel: 'gpt-6.1-sol',
  supportsMask: true,
  supportsGif: true,
  supportsSvg: true,
  capabilityMask: 'auto',
  capabilityGif: 'auto',
  capabilitySvg: 'auto',
  pricingMode: 'unified',
  priceUnified: 0.1,
  price1K: null,
  price2K: null,
  price4K: null,
  rateTextInput: null,
  rateImageInput: null,
  rateImageOutput: null,
  isDefault: true,
  position: 0,
  createdAt: '2026-11-15T00:00:00.000Z',
  updatedAt: '2026-11-15T00:00:00.000Z'
}

describe('对外 DTO 投影', () => {
  it('供应商投影里绝不出现 apiKey', () => {
    const projected = toPublicProvider(provider, { mask: true, gif: false, svg: false }, ['gpt-image-2.6'])
    const serialized = JSON.stringify(projected)
    expect(serialized).not.toContain('sk-super-secret')
    expect(serialized).not.toContain('apiKey"')
    expect(projected.apiKeyConfigured).toBe(true)
    expect(projected.capabilities).toEqual({ mask: true, gif: false, svg: false })
    expect(projected.models).toEqual(['gpt-image-2.6'])
  })

  it('没有配置密钥时布尔为 false', () => {
    const projected = toPublicProvider({ ...provider, apiKey: null }, { mask: true, gif: false, svg: false }, [])
    expect(projected.apiKeyConfigured).toBe(false)
  })

  it('会话投影只带参考图元信息，不带磁盘路径', () => {
    const projected = toPublicConversation({
      id: 'c1',
      title: '会话',
      draftPrompt: '草稿',
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
      referenceImages: [
        { id: 'r1', name: 'ref.png', mimeType: 'image/png', filePath: 'C:/secret/ref.png', fileSizeBytes: 10, createdAt: '2026-11-15T00:00:00.000Z' }
      ],
      createdAt: '2026-11-15T00:00:00.000Z',
      updatedAt: '2026-11-15T00:00:00.000Z'
    })
    expect(projected.referenceImageCount).toBe(1)
    expect(JSON.stringify(projected)).not.toContain('C:/secret')
  })

  it('历史条目保留 filePath 供 agent 直接用，错误详情不外泄', () => {
    const projected = toPublicHistory({
      id: 'h1',
      conversationId: 'c1',
      runId: 'r1',
      prompt: '提示词',
      model: 'gpt-image-2.6',
      ratio: '1:1',
      size: '1024x1024',
      quality: 'high',
      requestIndex: 0,
      durationMs: 1200,
      filePath: 'C:/images/h1.png',
      fileSizeBytes: 100,
      status: 'succeeded',
      errorMessage: null,
      errorDetails: '{"stack":"secret"}',
      favorite: false,
      generationMode: 'text-to-image',
      referenceImages: [],
      createdAt: '2026-11-15T00:00:00.000Z'
    })
    expect(projected.filePath).toBe('C:/images/h1.png')
    expect(JSON.stringify(projected)).not.toContain('stack')
  })
})
