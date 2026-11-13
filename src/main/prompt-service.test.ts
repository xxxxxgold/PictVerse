import { describe, expect, it, vi } from 'vitest'
import { PromptService } from './prompt-service'
import {
  buildPromptRequestBody,
  normalizePromptAssistConfig,
  PROMPT_PROTOCOL_ENDPOINTS,
  type PromptAssistConfig
} from '@shared/prompt-assistant'

describe('prompt service', () => {
  it('uses the configured protocol endpoint and model', async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { content: '一座清晨雾气中的玻璃温室，柔和自然光，电影感构图。' } }]
    }), { status: 200 })))
    globalThis.fetch = fetchMock as typeof fetch

    try {
      const service = new PromptService(createSettings())
      const result = await service.inspire({ hasReferenceImages: true, config: createConfig() })
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      const body = JSON.parse(String(init.body))

      expect(url).toBe('https://example.test/v1/chat/completions')
      expect(body.model).toBe('gpt-5.4-mini')
      expect(JSON.stringify(body.messages)).toContain('参考图')
      expect(result).toBe('一座清晨雾气中的玻璃温室，柔和自然光，电影感构图。')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('sends max_tokens and reasoning_effort for chat protocol', async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' } }]
    }), { status: 200 })))
    globalThis.fetch = fetchMock as typeof fetch

    try {
      const service = new PromptService(createSettings())
      await service.enrich({ prompt: 'portrait', config: createConfig() })
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      const body = JSON.parse(String(init.body))

      expect(body.max_tokens).toBe(1000)
      expect(body.reasoning_effort).toBe('medium')
      // 上下文预算注入 system 提示
      expect(JSON.stringify(body.messages)).toContain('上下文预算：32K')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('routes responses protocol and extracts output_text', async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      output_text: 'expanded prompt'
    }), { status: 200 })))
    globalThis.fetch = fetchMock as typeof fetch

    try {
      const service = new PromptService(createSettings())
      const result = await service.enrich({ prompt: 'portrait', config: createConfig('responses') })
      const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toBe('https://example.test/v1/responses')
      expect(result).toBe('expanded prompt')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('routes anthropic protocol with x-api-key header', async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      content: [{ type: 'text', text: 'anthropic prompt' }]
    }), { status: 200 })))
    globalThis.fetch = fetchMock as typeof fetch

    try {
      const service = new PromptService(createSettings())
      const result = await service.enrich({ prompt: 'portrait', config: createConfig('anthropic') })
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      const headers = init.headers as Record<string, string>
      expect(url).toBe('https://example.test/v1/messages')
      expect(headers['x-api-key']).toBe('sk-test')
      expect(headers['anthropic-version']).toBe('2023-06-01')
      expect(result).toBe('anthropic prompt')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('falls back to the global API key when the assistant config has none', async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' } }]
    }), { status: 200 })))
    globalThis.fetch = fetchMock as typeof fetch

    try {
      const service = new PromptService(createSettings())
      const config = createConfig()
      config.apiKey = ''
      await service.inspire({ config })
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      const headers = init.headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer sk-test')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('surfaces API error messages', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      error: { message: 'model unavailable' }
    }), { status: 400 }))) as typeof fetch

    try {
      const service = new PromptService(createSettings())
      await expect(service.inspire({ config: createConfig() })).rejects.toThrow('model unavailable')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('request body builders', () => {
  it('builds anthropic thinking budget by reasoning level', () => {
    const config = normalizePromptAssistConfig({ ...createConfig('anthropic'), reasoning: 'high' })
    const body = buildPromptRequestBody(config, 'system', 'user')
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 8192 })
    expect(body.max_tokens).toBe(1000)
  })

  it('omits optional fields when set to defaults', () => {
    const config = normalizePromptAssistConfig({ ...createConfig(), contextK: 0, maxOutputTokens: 0, reasoning: 'off' })
    const body = buildPromptRequestBody(config, 'system', 'user')
    expect(body.max_tokens).toBeUndefined()
    expect(body.reasoning_effort).toBeUndefined()
  })
})

describe('endpoint builders', () => {
  it('trims trailing slashes from base urls', () => {
    expect(PROMPT_PROTOCOL_ENDPOINTS.chat('https://api.test/')).toBe('https://api.test/v1/chat/completions')
    expect(PROMPT_PROTOCOL_ENDPOINTS.anthropic(' https://claude.test ')).toBe('https://claude.test/v1/messages')
  })
})

function createConfig(protocol: 'chat' | 'responses' | 'anthropic' = 'chat'): PromptAssistConfig {
  return normalizePromptAssistConfig({
    name: '测试服务',
    baseURL: 'https://example.test',
    apiKey: 'sk-test',
    model: 'gpt-5.4-mini',
    protocol,
    contextK: 32,
    maxOutputTokens: 1000,
    reasoning: 'medium'
  })
}

function createSettings() {
  return {
    getPublicSettings: () => ({
      baseURL: 'https://example.test',
      defaultModel: 'gpt-image-2',
      promptModel: 'gpt-5.4-mini',
      apiKeyStored: true,
      insecureStorage: false
    }),
    getApiKey: () => 'sk-test'
  } as never
}
