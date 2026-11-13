export type PromptAssistantProtocol = 'chat' | 'responses' | 'anthropic'

export type PromptAssistConfig = {
  /** 服务商名称，仅展示用 */
  name: string
  baseURL: string
  apiKey: string
  model: string
  protocol: PromptAssistantProtocol
  /** 请求携带的上下文长度（K tokens），0 表示跟随默认 */
  contextK: number
  /** 最大输出 tokens，0 表示跟随默认 */
  maxOutputTokens: number
  /** 思考强度：关闭 / 低 / 中 / 高 */
  reasoning: 'off' | 'low' | 'medium' | 'high'
}

export const PROMPT_PROTOCOL_LABELS: Record<PromptAssistantProtocol, string> = {
  chat: 'chat（/v1/chat/completions）',
  responses: 'responses（/v1/responses）',
  anthropic: 'anthropic（/v1/messages）'
}

export const PROMPT_PROTOCOL_ENDPOINTS: Record<PromptAssistantProtocol, (baseURL: string) => string> = {
  chat: (baseURL) => `${trimBase(baseURL)}/v1/chat/completions`,
  responses: (baseURL) => `${trimBase(baseURL)}/v1/responses`,
  anthropic: (baseURL) => `${trimBase(baseURL)}/v1/messages`
}

export const PROMPT_CONTEXT_OPTIONS = [0, 8, 16, 32, 64, 128, 200]
export const PROMPT_OUTPUT_OPTIONS = [0, 300, 500, 700, 1000, 1500, 2000, 4000]
export const PROMPT_REASONING_OPTIONS: Array<{ key: PromptAssistConfig['reasoning']; label: string }> = [
  { key: 'off', label: '关闭' },
  { key: 'low', label: '低' },
  { key: 'medium', label: '中' },
  { key: 'high', label: '高' }
]

export const DEFAULT_PROMPT_ASSIST_CONFIG: PromptAssistConfig = {
  name: '提示词服务',
  baseURL: 'https://api.openai.com',
  apiKey: '',
  model: 'gpt-5.4-mini',
  protocol: 'chat',
  contextK: 0,
  maxOutputTokens: 700,
  reasoning: 'off'
}

export function normalizePromptAssistConfig(raw: unknown): PromptAssistConfig {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<PromptAssistConfig>
  const protocol: PromptAssistantProtocol =
    value.protocol === 'responses' || value.protocol === 'anthropic' ? value.protocol : 'chat'
  const reasoning: PromptAssistConfig['reasoning'] =
    value.reasoning === 'low' || value.reasoning === 'medium' || value.reasoning === 'high' ? value.reasoning : 'off'
  return {
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : DEFAULT_PROMPT_ASSIST_CONFIG.name,
    baseURL: typeof value.baseURL === 'string' ? value.baseURL.trim().replace(/\/+$/, '') : DEFAULT_PROMPT_ASSIST_CONFIG.baseURL,
    apiKey: typeof value.apiKey === 'string' ? value.apiKey : '',
    model: typeof value.model === 'string' && value.model.trim() ? value.model.trim() : DEFAULT_PROMPT_ASSIST_CONFIG.model,
    protocol,
    contextK: clampInt(value.contextK, 0, 1000, 0),
    maxOutputTokens: clampInt(value.maxOutputTokens, 0, 32000, 700),
    reasoning
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback
  return Math.min(max, Math.max(min, num))
}

/** 上下文预算作为 system 提示的一部分注入，三种协议统一生效 */
export function buildContextBudgetNote(config: PromptAssistConfig): string {
  if (config.contextK > 0) {
    return `（上下文预算：${config.contextK}K tokens，请保持回答紧凑。）`
  }
  return ''
}

function trimBase(baseURL: string): string {
  return baseURL.trim().replace(/\/+$/, '')
}

export function buildPromptRequestBody(config: PromptAssistConfig, system: string, user: string): Record<string, unknown> {
  const maxTokens = config.maxOutputTokens > 0 ? config.maxOutputTokens : undefined
  const contextK = config.contextK > 0 ? config.contextK : undefined

  if (config.protocol === 'chat') {
    return {
      model: config.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
      ...(config.reasoning !== 'off' ? { reasoning_effort: config.reasoning } : {})
    }
  }

  if (config.protocol === 'responses') {
    return {
      model: config.model,
      instructions: system,
      input: user,
      ...(maxTokens ? { max_output_tokens: maxTokens } : {}),
      ...(config.reasoning !== 'off' ? { reasoning: { effort: config.reasoning } } : {})
    }
  }

  // anthropic
  const budgetByReasoning: Record<PromptAssistConfig['reasoning'], number | undefined> = {
    off: undefined,
    low: 1024,
    medium: 4096,
    high: 8192
  }
  const budget = budgetByReasoning[config.reasoning]
  return {
    model: config.model,
    system,
    max_tokens: maxTokens || 700,
    messages: [{ role: 'user', content: user }],
    ...(budget ? { thinking: { type: 'enabled', budget_tokens: budget } } : {})
  }
}

export function buildPromptHeaders(config: PromptAssistConfig): Record<string, string> {
  if (config.protocol === 'anthropic') {
    return {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01'
    }
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.apiKey}`
  }
}
