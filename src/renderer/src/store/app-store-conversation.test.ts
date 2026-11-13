import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Conversation, Provider } from '@shared/types'
import { useAppStore } from './app-store'

describe('app store conversation defaults', () => {
  const originalWindow = globalThis.window

  afterEach(() => {
    useAppStore.setState({
      conversations: [],
      activeConversationId: null,
      runsByConversation: {},
      toast: null
    })
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true
    })
    vi.restoreAllMocks()
  })

  it('creates a new conversation with the active conversation image settings', async () => {
    const active = createConversation({ id: 'old', ratio: '9:16', size: '2160x3840', quality: 'medium' })
    const created = createConversation({ id: 'new', ratio: '9:16', size: '2160x3840', quality: 'medium' })
    const create = vi.fn(() => Promise.resolve(created))
    installWindow({ create })
    useAppStore.setState({
      conversations: [active],
      activeConversationId: active.id,
      runsByConversation: { [active.id]: [] },
      toast: null
    })

    await useAppStore.getState().createConversation()

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      ratio: '9:16',
      size: '2160x3840',
      quality: 'medium',
      model: 'gpt-image-2',
      n: 1,
      outputFormat: 'png',
      outputCompression: null,
      background: 'auto',
      moderation: 'auto',
      stream: false,
      partialImages: 0,
      inputFidelity: null,
      autoSaveHistory: true,
      keepFailureDetails: false
    }))
    expect(useAppStore.getState().activeConversationId).toBe('new')
    expect(useAppStore.getState().conversations[0]).toMatchObject({
      id: 'new',
      ratio: '9:16',
      size: '2160x3840',
      quality: 'medium'
    })
  })

  it('uses the standard resolution when changing ratios without an explicit size', async () => {
    const active = createConversation({ id: 'c1', ratio: '16:9', size: '3840x2160', quality: 'high' })
    const update = vi.fn((_id: string, input: Partial<Conversation>) => Promise.resolve({ ...active, ...input }))
    installWindow({ update })
    useAppStore.setState({
      conversations: [active],
      activeConversationId: active.id,
      toast: null
    })

    await useAppStore.getState().updateActiveConversation({ ratio: '9:16' })

    expect(update).toHaveBeenCalledWith(active.id, { ratio: '9:16', size: '1008x1792' })
    expect(useAppStore.getState().conversations[0]).toMatchObject({
      ratio: '9:16',
      size: '1008x1792'
    })
  })

  it('falls back to png when switching to a model without gif support', async () => {
    const active = createConversation({ id: 'c1', model: 'gpt-image-2.6-flare', outputFormat: 'gif' })
    const update = vi.fn((_id: string, input: Partial<Conversation>) => Promise.resolve({ ...active, ...input }))
    installWindow({ update })
    useAppStore.setState({
      conversations: [active],
      activeConversationId: active.id,
      toast: null
    })

    await useAppStore.getState().updateActiveConversation({ model: 'gpt-image-2.5-flare' })

    expect(update).toHaveBeenCalledWith(active.id, { model: 'gpt-image-2.5-flare', outputFormat: 'png' })
    expect(useAppStore.getState().conversations[0]).toMatchObject({
      model: 'gpt-image-2.5-flare',
      outputFormat: 'png'
    })
  })

  it('keeps the current format when the target model still supports it', async () => {
    const active = createConversation({ id: 'c1', model: 'gpt-image-2.5-flare', outputFormat: 'webp' })
    const update = vi.fn((_id: string, input: Partial<Conversation>) => Promise.resolve({ ...active, ...input }))
    installWindow({ update })
    useAppStore.setState({
      conversations: [active],
      activeConversationId: active.id,
      toast: null
    })

    await useAppStore.getState().updateActiveConversation({ model: 'gpt-image-2.6-flare' })

    expect(update).toHaveBeenCalledWith(active.id, { model: 'gpt-image-2.6-flare' })
  })

  it('keeps gif when the default provider forces the capability on (providerId is null)', async () => {
    const active = createConversation({ id: 'c1', model: 'gpt-image-2.5-flare', outputFormat: 'gif' })
    const update = vi.fn((_id: string, input: Partial<Conversation>) => Promise.resolve({ ...active, ...input }))
    installWindow({ update })
    useAppStore.setState({
      conversations: [active],
      activeConversationId: active.id,
      // 会话 providerId 恒为 null，必须靠默认供应商兜底才能拿到 override
      providers: [createProvider({ capabilityGif: 'on' })],
      toast: null
    })

    await useAppStore.getState().updateActiveConversation({ model: 'gpt-image-2.5-flare' })

    // 强制开生效：gif 不被回落
    expect(update).toHaveBeenCalledWith(active.id, { model: 'gpt-image-2.5-flare' })
  })

  it('falls back to png when the default provider forces gif off', async () => {
    const active = createConversation({ id: 'c1', model: 'gpt-image-2.6-flare', outputFormat: 'gif' })
    const update = vi.fn((_id: string, input: Partial<Conversation>) => Promise.resolve({ ...active, ...input }))
    installWindow({ update })
    useAppStore.setState({
      conversations: [active],
      activeConversationId: active.id,
      providers: [createProvider({ capabilityGif: 'off' })],
      toast: null
    })

    await useAppStore.getState().updateActiveConversation({ model: 'gpt-image-2.6-flare' })

    // 强制关生效：2.6 本可 gif，但 override 为 off，必须回落
    expect(update).toHaveBeenCalledWith(active.id, {
      model: 'gpt-image-2.6-flare',
      outputFormat: 'png'
    })
  })

  it('clears the pending mask when the target model cannot use masks', async () => {
    const active = createConversation({ id: 'c1', model: 'gpt-image-2.6-flare' })
    const update = vi.fn((_id: string, input: Partial<Conversation>) => Promise.resolve({ ...active, ...input }))
    installWindow({ update })
    useAppStore.setState({
      conversations: [active],
      activeConversationId: active.id,
      providers: [createProvider({ capabilityMask: 'off' })],
      pendingMask: { dataUrl: 'data:image/png;base64,AAA', previewUrl: 'blob:x', referenceId: active.id },
      toast: null
    })

    await useAppStore.getState().updateActiveConversation({ model: 'gpt-image-2.5-flare' })

    expect(useAppStore.getState().pendingMask).toBeNull()
    expect(useAppStore.getState().toast).toContain('遮罩')
  })
})

function createProvider(input: Partial<Provider> = {}): Provider {
  return {
    id: 'p1',
    name: '默认供应商',
    baseURL: 'https://example.test',
    apiKey: null,
    defaultModel: 'gpt-image-2',
    promptModel: null,
    supportsMask: true,
    supportsGif: false,
    supportsSvg: false,
    capabilityMask: 'auto',
    capabilityGif: 'auto',
    capabilitySvg: 'auto',
    pricingMode: 'unified',
    priceUnified: null,
    price1K: null,
    price2K: null,
    price4K: null,
    rateTextInput: null,
    rateImageInput: null,
    rateImageOutput: null,
    isDefault: true,
    position: 0,
    createdAt: '2026-05-10T00:00:00.000Z',
    updatedAt: '2026-05-10T00:00:00.000Z',
    ...input
  }
}

function installWindow(conversation: {
  create?: ReturnType<typeof vi.fn>
  update?: ReturnType<typeof vi.fn>
}): void {
  Object.defineProperty(globalThis, 'window', {
    value: {
      setTimeout: globalThis.setTimeout,
      clearInterval: globalThis.clearInterval,
      pictverse: {
        conversation
      }
    },
    configurable: true
  })
}

function createConversation(input: Partial<Conversation> = {}): Conversation {
  return {
    id: 'c1',
    title: '新会话',
    draftPrompt: '',
    model: 'gpt-image-2',
    ratio: '1:1',
    size: '1024x1024',
    quality: 'auto',
    n: 1,
    outputFormat: 'png',
    outputCompression: null,
    background: 'auto',
    moderation: 'auto',
    stream: false,
    partialImages: 0,
    inputFidelity: null,
    providerId: null,
    complexity: null,
    frameCount: null,
    frameDurationMs: null,
    seed: null,
    seedLocked: false,
    autoSaveHistory: true,
    keepFailureDetails: false,
    referenceImages: [],
    createdAt: '2026-05-10T00:00:00.000Z',
    updatedAt: '2026-05-10T00:00:00.000Z',
    ...input
  }
}
