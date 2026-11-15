import { describe, expect, it, vi } from 'vitest'
import { PromptService } from './prompt-service'
import {
  buildContextBudgetNote,
  buildModelListHeaders,
  buildPromptRequestBody,
  buildSystemPrompt,
  DEFAULT_CONTEXT_TOKENS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  extractMaxTokenLimit,
  normalizePromptAssistConfig,
  parseTokenAmount,
  resolveContextTokens,
  shouldRetryWithLegacy,
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
      expect(body.model).toBe('gpt-6.1-sol')
      expect(JSON.stringify(body.messages)).toContain('参考图')
      expect(result).toBe('一座清晨雾气中的玻璃温室，柔和自然光，电影感构图。')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('sends max_completion_tokens and reasoning_effort for chat protocol', async () => {
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

      // max_tokens 已废弃，新写法用 max_completion_tokens
      expect(body.max_completion_tokens).toBe(1000)
      expect(body.max_tokens).toBeUndefined()
      expect(body.reasoning_effort).toBe('medium')
      // 上下文预算注入 system 提示（语义化输入 32k → 32000，展示还原为 32k）
      expect(JSON.stringify(body.messages)).toContain('上下文预算：32k')
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
  it('builds anthropic modern thinking as output_config.effort', () => {
    const config = normalizePromptAssistConfig({ ...createConfig('anthropic'), reasoning: 'max' })
    const body = buildPromptRequestBody(config, 'system', 'user')
    expect(body.output_config).toEqual({ effort: 'max' })
    expect(body.thinking).toBeUndefined()
    expect(body.max_tokens).toBe(1000)
  })

  it('builds anthropic legacy thinking budget on the legacy wire', () => {
    const config = normalizePromptAssistConfig({ ...createConfig('anthropic'), reasoning: 'max' })
    const body = buildPromptRequestBody(config, 'system', 'user', 'legacy')
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 16384 })
    expect(body.output_config).toBeUndefined()
    // max_tokens 必须大于 budget_tokens，否则 anthropic 会拒绝请求
    expect(body.max_tokens).toBe(16384 + 1024)
  })

  it('omits thinking fields entirely when anthropic reasoning is off', () => {
    const config = normalizePromptAssistConfig({ ...createConfig('anthropic'), reasoning: 'off' })
    expect(buildPromptRequestBody(config, 'system', 'user').output_config).toBeUndefined()
    expect(buildPromptRequestBody(config, 'system', 'user', 'legacy').thinking).toBeUndefined()
  })

  it('sends reasoning_effort none when chat reasoning is off', () => {
    const config = normalizePromptAssistConfig({ ...createConfig(), reasoning: 'off' })
    // modern：显式 none 才真正关掉思考，否则服务端默认 medium
    expect(buildPromptRequestBody(config, 'system', 'user').reasoning_effort).toBe('none')
    // legacy：老网关不认识 none，直接不发
    expect(buildPromptRequestBody(config, 'system', 'user', 'legacy').reasoning_effort).toBeUndefined()
  })

  it('omits optional length fields when explicitly set to zero', () => {
    // 留空 = 内置默认 32k；输入 0 = 不限制（不发送长度字段）
    const config = normalizePromptAssistConfig({
      ...createConfig(),
      contextTokenText: '0',
      maxOutputTokenText: '0',
      reasoning: 'off'
    })
    const body = buildPromptRequestBody(config, 'system', 'user')
    expect(body.max_completion_tokens).toBeUndefined()
    expect(body.max_tokens).toBeUndefined()
  })

  it('falls back to the builtin default output tokens when left empty', () => {
    const config = normalizePromptAssistConfig({
      ...createConfig(),
      contextTokenText: '',
      maxOutputTokenText: '',
      reasoning: 'off'
    })
    expect(DEFAULT_CONTEXT_TOKENS).toBe(256_000)
    expect(DEFAULT_MAX_OUTPUT_TOKENS).toBe(32_000)
    expect(buildPromptRequestBody(config, 'system', 'user').max_completion_tokens).toBe(32_000)
  })

  it('keeps the default context quiet in the system prompt', () => {
    // 留空跟随默认 256k：不该把「请保持回答紧凑」塞进 system
    const config = normalizePromptAssistConfig({ ...createConfig(), contextTokenText: '' })
    expect(resolveContextTokens(config)).toBe(DEFAULT_CONTEXT_TOKENS)
    expect(buildContextBudgetNote(0)).toBe('')
  })
})

describe('legacy wire fallback', () => {
  it('retries with legacy body when chat rejects the modern parameter', async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: 'Unrecognized request argument supplied: max_completion_tokens' }
      }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: 'legacy ok' } }]
      }), { status: 200 }))
    globalThis.fetch = fetchMock as typeof fetch

    try {
      const service = new PromptService(createSettings())
      const result = await service.enrich({ prompt: 'portrait', config: createConfig() })
      expect(result).toBe('legacy ok')
      expect(fetchMock).toHaveBeenCalledTimes(2)
      const second = JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body))
      expect(second.max_tokens).toBe(1000)
      expect(second.max_completion_tokens).toBeUndefined()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('retries with legacy body when anthropic rejects adaptive thinking', async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: 'thinking.type.enabled is not supported for this model. Use thinking.type.adaptive and output_config.effort' }
      }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        content: [{ type: 'text', text: 'legacy anthropic' }]
      }), { status: 200 }))
    globalThis.fetch = fetchMock as typeof fetch

    try {
      const service = new PromptService(createSettings())
      const result = await service.enrich({ prompt: 'portrait', config: createConfig('anthropic') })
      expect(result).toBe('legacy anthropic')
      const first = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))
      const second = JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body))
      // 首轮 modern 用 output_config.effort；重试改用 legacy 的 thinking budget
      expect(first.output_config).toEqual({ effort: 'medium' })
      expect(first.thinking).toBeUndefined()
      expect(second.thinking).toEqual({ type: 'enabled', budget_tokens: 4096 })
      expect(second.output_config).toBeUndefined()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('does not retry on auth or quota errors', async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      error: { message: 'invalid api key' }
    }), { status: 401 })))
    globalThis.fetch = fetchMock as typeof fetch

    try {
      const service = new PromptService(createSettings())
      await expect(service.inspire({ config: createConfig() })).rejects.toThrow('invalid api key')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('classifies retryable parameter errors per protocol', () => {
    expect(shouldRetryWithLegacy('chat', 400, 'Unrecognized request argument: max_completion_tokens')).toBe(true)
    expect(shouldRetryWithLegacy('anthropic', 400, 'adaptive thinking is not supported on this model')).toBe(true)
    expect(shouldRetryWithLegacy('chat', 401, 'max_completion_tokens rejected')).toBe(false)
    expect(shouldRetryWithLegacy('responses', 400, 'max_output_tokens invalid')).toBe(false)
  })

  it('does not treat ceiling errors as unsupported parameters', () => {
    // 这类报错要走上限收敛，不该先白跑一次 legacy
    expect(shouldRetryWithLegacy('chat', 400, 'max_completion_tokens: 32000 > 8000, which is the maximum allowed')).toBe(false)
    expect(shouldRetryWithLegacy('chat', 400, 'max_output_tokens must be less than or equal to 16384')).toBe(false)
  })
})

describe('output token limit convergence', () => {
  it('does not retry when the configured output already fits the ceiling', async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      error: { message: 'max_tokens: 32000 > 8192, which is the maximum allowed for this model' }
    }), { status: 400 })))
    globalThis.fetch = fetchMock as typeof fetch

    try {
      const service = new PromptService(createSettings())
      // createConfig 显式填了 1000，低于报错里的 8192 上限，属于别的错误，不该盲目重试
      await expect(service.enrich({ prompt: 'portrait', config: createConfig() }))
        .rejects.toThrow('8192')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('converges when the configured output exceeds the ceiling', async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: 'max_output_tokens must be less than or equal to 16384' }
      }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: 'ok' } }]
      }), { status: 200 }))
    globalThis.fetch = fetchMock as typeof fetch

    try {
      const service = new PromptService(createSettings())
      const config = { ...createConfig(), maxOutputTokenText: '32k' }
      const result = await service.enrich({ prompt: 'portrait', config })
      expect(result).toBe('ok')
      const second = JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body))
      expect(second.max_completion_tokens).toBe(16384)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('parses ceilings from common error wordings', () => {
    expect(extractMaxTokenLimit('max_tokens: 32000 > 8192, which is the maximum allowed')).toBe(8192)
    expect(extractMaxTokenLimit('max_output_tokens must be less than or equal to 16384')).toBe(16384)
    expect(extractMaxTokenLimit('invalid api key')).toBeNull()
  })
})

describe('model list headers', () => {
  it('uses x-api-key and version header for anthropic', () => {
    const headers = buildModelListHeaders({ protocol: 'anthropic', apiKey: 'sk-a' })
    expect(headers['x-api-key']).toBe('sk-a')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers.Authorization).toBeUndefined()
  })

  it('uses bearer for chat and responses', () => {
    expect(buildModelListHeaders({ protocol: 'chat', apiKey: 'sk-b' }).Authorization).toBe('Bearer sk-b')
    expect(buildModelListHeaders({ protocol: 'responses', apiKey: 'sk-c' }).Authorization).toBe('Bearer sk-c')
  })
})

describe('token text parsing', () => {
  it('parses 1m / 1k / plain numbers with the same rule', () => {
    expect(parseTokenAmount('1m')).toBe(1_000_000)
    expect(parseTokenAmount('1M')).toBe(1_000_000)
    expect(parseTokenAmount('1k')).toBe(1_000)
    expect(parseTokenAmount('1000')).toBe(1_000)
    expect(parseTokenAmount('1.5k')).toBe(1_500)
    expect(parseTokenAmount('2 m')).toBe(2_000_000)
  })

  it('returns null for invalid or empty input', () => {
    expect(parseTokenAmount('')).toBeNull()
    expect(parseTokenAmount('abc')).toBeNull()
    expect(parseTokenAmount('1x')).toBeNull()
    expect(parseTokenAmount(null)).toBeNull()
  })

  it('resolves effective tokens with fallback and caps', () => {
    const resolved = normalizePromptAssistConfig({
      ...createConfig(),
      contextTokenText: '1m',
      maxOutputTokenText: '1k'
    })
    expect(resolved.contextTokenText).toBe('1m')
    expect(resolved.maxOutputTokenText).toBe('1k')
  })

  it('migrates legacy numeric contextK (K tokens) and maxOutputTokens fields', () => {
    const migrated = normalizePromptAssistConfig({
      name: '旧配置',
      baseURL: 'https://example.test',
      apiKey: 'sk-test',
      model: 'gpt-5.4-mini',
      protocol: 'chat',
      contextK: 32,
      maxOutputTokens: 700,
      reasoning: 'medium'
    })
    expect(migrated.contextTokenText).toBe('32k')
    expect(migrated.maxOutputTokenText).toBe('700')
    expect(migrated.model).toBe('gpt-5.4-mini')
    expect(migrated.reasoning).toBe('medium')
  })

  it('keeps legacy non-round output values readable (no thousands separators)', () => {
    const migrated = normalizePromptAssistConfig({ ...createConfig(), maxOutputTokenText: '', maxOutputTokens: 1500 })
    expect(migrated.maxOutputTokenText).toBe('1500')
    const body = buildPromptRequestBody(migrated, 'system', 'user')
    expect(body.max_completion_tokens).toBe(1500)
  })
})

describe('custom prompts', () => {
  it('sends role + system prompts as the chat system message', async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' } }]
    }), { status: 200 })))
    globalThis.fetch = fetchMock as typeof fetch

    try {
      const service = new PromptService(createSettings())
      await service.enrich({
        prompt: 'portrait',
        config: {
          ...createConfig(),
          contextTokenText: '',
          rolePrompt: '资深电影分镜师',
          systemPrompt: '始终输出分镜表。'
        }
      })
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      const body = JSON.parse(String(init.body))
      const messages = body.messages as Array<{ role: string; content: string }>
      expect(messages[0].content).toBe('你是资深电影分镜师。始终输出分镜表。')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('falls back to the builtin role and system prompts when left empty', () => {
    const config = normalizePromptAssistConfig({ ...createConfig(), rolePrompt: '', systemPrompt: '' })
    expect(buildSystemPrompt(config)).toBe('你是专业图像生成提示词助手。输出简洁、具体、可直接用于生成图片的提示词。')
  })

  it('renders the context budget note in semantic units', () => {
    expect(buildContextBudgetNote(1_000_000)).toContain('1m tokens')
    expect(buildContextBudgetNote(32_000)).toContain('32k tokens')
    expect(buildContextBudgetNote(0)).toBe('')
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
    model: 'gpt-6.1-sol',
    protocol,
    contextTokenText: '32k',
    maxOutputTokenText: '1000',
    reasoning: 'medium'
  })
}

function createSettings() {
  return {
    getPublicSettings: () => ({
      baseURL: 'https://example.test',
      defaultModel: 'gpt-image-2',
      promptModel: 'gpt-6.1-sol',
      apiKeyStored: true,
      insecureStorage: false
    }),
    getApiKey: () => 'sk-test'
  } as never
}
