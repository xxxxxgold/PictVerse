export type PromptAssistantProtocol = 'chat' | 'responses' | 'anthropic'

/** Anthropic 接口版本头；官方标为可选，但原生接口与部分网关要求带上 */
export const ANTHROPIC_API_VERSION = '2023-06-01'

/** 思考强度档位：透传英文值，chat → reasoning_effort，responses → reasoning.effort，anthropic → thinking budget */
export type PromptReasoningEffort = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type PromptAssistConfig = {
  /** 服务商名称，仅展示用 */
  name: string
  baseURL: string
  apiKey: string
  model: string
  protocol: PromptAssistantProtocol
  /** 上下文长度输入原文（如 1m / 1k / 1000），空表示跟随默认 */
  contextTokenText: string
  /** 输出长度输入原文（如 1m / 1k / 1000），空表示跟随默认 */
  maxOutputTokenText: string
  /** 思考强度：off / low / medium / high / xhigh / max */
  reasoning: PromptReasoningEffort
  /** 角色提示词：助手人设/风格，为空时回退内置角色；拼在系统提示词开头 */
  rolePrompt: string
  /** 系统提示词：整段替换内置系统提示词，为空时使用内置 */
  systemPrompt: string
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

export const PROMPT_REASONING_OPTIONS: Array<{ key: PromptReasoningEffort; label: string }> = [
  { key: 'off', label: 'off' },
  { key: 'low', label: 'low' },
  { key: 'medium', label: 'medium' },
  { key: 'high', label: 'high' },
  { key: 'xhigh', label: 'xhigh' },
  { key: 'max', label: 'max' }
]

export const DEFAULT_PROMPT_ASSIST_CONFIG: PromptAssistConfig = {
  name: '提示词服务',
  baseURL: 'https://api.openai.com',
  apiKey: '',
  model: 'gpt-6.1-sol',
  protocol: 'chat',
  // 留空表示跟随默认（上下文 256k / 输出 32k）；填了才注入预算注记
  contextTokenText: '',
  maxOutputTokenText: '',
  reasoning: 'off',
  rolePrompt: '',
  systemPrompt: ''
}

/**
 * 模型是否已被用户显式选定。
 *
 * 内置默认模型（DEFAULT_PROMPT_ASSIST_CONFIG.model）只是占位，不该冒充用户选择。
 * 设置面板的显示与保存都走这个口径，避免「服务端返回的候选里没有该模型，
 * 输入框却显示它」以及「把占位值写进 promptModel」两类问题。
 * - 空值 → 未选定
 * - 用户改过输入（touched）→ 已选定
 * - 不是内置默认值 → 已选定（用户配置过或手动填过）
 * - 是内置默认值，但服务端候选里确实有它 → 视为已选定（该服务真有这个模型）
 */
export function isAssistantModelChosen(
  model: string | null | undefined,
  options: readonly string[],
  touched: boolean
): boolean {
  const value = String(model ?? '').trim()
  if (!value) return false
  if (touched) return true
  if (value !== DEFAULT_PROMPT_ASSIST_CONFIG.model) return true
  const lower = value.toLowerCase()
  return options.some((item) => item.trim().toLowerCase() === lower)
}

/** 内置角色提示词：用户未填写角色时的回退 */
export const BUILTIN_ROLE_PROMPT = '专业图像生成提示词助手'

/** 内置系统提示词：用户未填写系统提示词时的回退 */
export const BUILTIN_SYSTEM_PROMPT = '输出简洁、具体、可直接用于生成图片的提示词。'

/** 上下文默认值（tokens）：不填或非法时使用 */
export const DEFAULT_CONTEXT_TOKENS = 256_000
/** 输出长度默认值（tokens）：不填或非法时使用 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 32_000
/** 输出长度上限（tokens）：保护请求体不会带出天文数字 */
export const MAX_OUTPUT_TOKENS_LIMIT = 4_000_000
/** 上下文上限（tokens）：仅用于提示注入的预算说明 */
export const MAX_CONTEXT_TOKENS_LIMIT = 4_000_000

/**
 * 解析语义化 token 输入：`1m` → 1,000,000，`1k` → 1,000，`1000` → 1,000。
 * 大小写不限、允许空格（如 "1 m"）；支持小数系数（如 1.5k → 1500，向上取整）。
 * 非法输入返回 null，由调用方决定回退值。
 */
export function parseTokenAmount(raw: string | null | undefined): number | null {
  const text = String(raw ?? '').trim().toLowerCase()
  if (!text) return null
  const match = text.match(/^(\d+(?:\.\d+)?)\s*(k|m)?$/)
  if (!match) return null
  const coefficient = Number.parseFloat(match[1])
  if (!Number.isFinite(coefficient)) return null
  const multiplier = match[2] === 'k' ? 1_000 : match[2] === 'm' ? 1_000_000 : 1
  return Math.ceil(coefficient * multiplier)
}

/** 组合当前生效的系统提示词：角色提示词 + 系统提示词（自定义优先，否则内置） */
export function buildSystemPrompt(config: Pick<PromptAssistConfig, 'rolePrompt' | 'systemPrompt'>): string {
  const role = config.rolePrompt.trim() || BUILTIN_ROLE_PROMPT
  const system = config.systemPrompt.trim() || BUILTIN_SYSTEM_PROMPT
  return `你是${role}。${system}`
}

/** 上下文预算注记：仅在显式设置上下文时注入 system 提示 */
export function buildContextBudgetNote(contextTokens: number): string {
  if (contextTokens > 0) {
    return `（上下文预算：${formatTokenAmount(contextTokens)} tokens，请保持回答紧凑。）`
  }
  return ''
}

/** 把 token 数还原成紧凑展示（1000 → 1k、1000000 → 1m）；其余用纯数字，保证可被 parseTokenAmount 回读 */
export function formatTokenAmount(tokens: number): string {
  if (tokens >= 1_000_000 && tokens % 1_000_000 === 0) return `${tokens / 1_000_000}m`
  if (tokens >= 1_000 && tokens % 1_000 === 0) return `${tokens / 1_000}k`
  return String(tokens)
}

export function normalizePromptAssistConfig(raw: unknown): PromptAssistConfig {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<PromptAssistConfig> & {
    /** 旧版字段：数字形式的上下文/输出长度（K tokens / tokens），仅用于迁移 */
    contextK?: unknown
    /** 旧版字段：数字形式的最大输出 tokens，仅用于迁移 */
    maxOutputTokens?: unknown
  }
  const protocol: PromptAssistantProtocol =
    value.protocol === 'responses' || value.protocol === 'anthropic' ? value.protocol : 'chat'
  const reasoning = normalizeReasoning(value.reasoning)
  // 兼容旧配置：旧 contextK 单位是 K tokens（需 ×1000），旧 maxOutputTokens 是原始 tokens
  const contextText = firstText(value.contextTokenText, legacyContextKToText(value.contextK))
  const outputText = firstText(value.maxOutputTokenText, legacyNumberToText(value.maxOutputTokens))
  return {
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : DEFAULT_PROMPT_ASSIST_CONFIG.name,
    baseURL: typeof value.baseURL === 'string' ? value.baseURL.trim().replace(/\/+$/, '') : DEFAULT_PROMPT_ASSIST_CONFIG.baseURL,
    apiKey: typeof value.apiKey === 'string' ? value.apiKey : '',
    model: typeof value.model === 'string' && value.model.trim() ? value.model.trim() : DEFAULT_PROMPT_ASSIST_CONFIG.model,
    protocol,
    contextTokenText: contextText,
    maxOutputTokenText: outputText,
    reasoning,
    rolePrompt: typeof value.rolePrompt === 'string' ? value.rolePrompt : '',
    systemPrompt: typeof value.systemPrompt === 'string' ? value.systemPrompt : ''
  }
}

/** 当前生效的上下文 tokens（0 表示未设置） */
export function resolveContextTokens(config: Pick<PromptAssistConfig, 'contextTokenText'>): number {
  const parsed = parseTokenAmount(config.contextTokenText)
  if (parsed === null) return DEFAULT_CONTEXT_TOKENS
  return Math.min(MAX_CONTEXT_TOKENS_LIMIT, parsed)
}

/** 当前生效的最大输出 tokens（0 表示未设置） */
export function resolveMaxOutputTokens(config: Pick<PromptAssistConfig, 'maxOutputTokenText'>): number {
  const parsed = parseTokenAmount(config.maxOutputTokenText)
  if (parsed === null) return DEFAULT_MAX_OUTPUT_TOKENS
  return Math.min(MAX_OUTPUT_TOKENS_LIMIT, parsed)
}

function normalizeReasoning(raw: unknown): PromptReasoningEffort {
  if (typeof raw === 'string') {
    const text = raw.trim().toLowerCase()
    // 兼容旧中文配置、早期误写与 "maximal" 写法
    if (text === '关闭') return 'off'
    if (text === '低' || text === 'minimal') return 'low'
    if (text === '中') return 'medium'
    if (text === '高' || text === 'maximal') return 'max'
    if (text === 'off' || text === 'low' || text === 'medium' || text === 'high' || text === 'xhigh' || text === 'max') {
      return text
    }
  }
  return 'off'
}

function firstText(primary: unknown, fallback: string): string {
  if (typeof primary === 'string' && primary.trim()) return primary.trim()
  return fallback
}

/** 旧数字配置 → 语义文本；0（跟随默认）→ 空串 */
function legacyNumberToText(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return formatTokenAmount(Math.trunc(value))
  }
  return ''
}

/** 旧 contextK 以 K tokens 为单位，迁移时换算成 tokens 再格式化（32 → 32k） */
function legacyContextKToText(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return formatTokenAmount(Math.trunc(value) * 1_000)
  }
  return ''
}

function trimBase(baseURL: string): string {
  return baseURL.trim().replace(/\/+$/, '')
}

/**
 * 请求体写法：
 * - modern：官方当前推荐写法（max_completion_tokens / thinking adaptive + output_config.effort）
 * - legacy：旧模型与老网关仍只认的写法（max_tokens / thinking enabled + budget_tokens）
 * 先发 modern，被拒时由调用方按 legacy 重试一次。
 */
export type PromptWireMode = 'modern' | 'legacy'

export function buildPromptRequestBody(
  config: PromptAssistConfig,
  system: string,
  user: string,
  wire: PromptWireMode = 'modern',
  maxTokensOverride?: number
): Record<string, unknown> {
  const resolved = resolveMaxOutputTokens(config)
  const maxTokens = (maxTokensOverride ?? resolved) > 0 ? (maxTokensOverride ?? resolved) : undefined

  if (config.protocol === 'chat') {
    // max_tokens 已废弃（且推理模型不兼容），legacy 才回退到它；
    // off 在 modern 下显式发 none，否则服务端默认 medium 等于没关
    const lengthField = wire === 'modern'
      ? (maxTokens ? { max_completion_tokens: maxTokens } : {})
      : (maxTokens ? { max_tokens: maxTokens } : {})
    const effortField = config.reasoning !== 'off'
      ? { reasoning_effort: config.reasoning }
      : wire === 'modern' ? { reasoning_effort: 'none' } : {}
    return {
      model: config.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      ...lengthField,
      ...effortField
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

  // anthropic：max_tokens 必填；thinking 的 token 计入 max_tokens，故上限要留出余量
  const budget = wire === 'legacy' ? anthropicThinkingBudget(config.reasoning) : undefined
  const baseMaxTokens = maxTokens || DEFAULT_MAX_OUTPUT_TOKENS
  const finalMaxTokens = budget ? Math.max(baseMaxTokens, budget + 1024) : baseMaxTokens
  const thinkingField = wire === 'modern'
    ? (config.reasoning !== 'off' ? { output_config: { effort: config.reasoning } } : {})
    : (budget ? { thinking: { type: 'enabled', budget_tokens: budget } } : {})
  return {
    model: config.model,
    system,
    max_tokens: finalMaxTokens,
    messages: [{ role: 'user', content: user }],
    ...thinkingField
  }
}

/** anthropic 旧式 thinking budget 映射：off 不开启；xhigh/max 逐级提高预算 */
function anthropicThinkingBudget(reasoning: PromptReasoningEffort): number | undefined {
  switch (reasoning) {
    case 'low':
      return 1024
    case 'medium':
      return 4096
    case 'high':
      return 8192
    case 'xhigh':
      return 12288
    case 'max':
      return 16384
    default:
      return undefined
  }
}

/**
 * 判断 modern 写法被拒后是否值得按 legacy 重试：
 * 只对参数不兼容类的 400/422 重试，鉴权、额度、模型不存在等错误直接抛出。
 */
export function shouldRetryWithLegacy(
  protocol: PromptAssistantProtocol,
  status: number,
  message: string
): boolean {
  if (status !== 400 && status !== 422) return false
  const text = message.toLowerCase()
  // 上限/范围类报错要走上限收敛，别当成「参数不支持」白跑一次 legacy
  if (/(greater than|exceeds?|maximum|less than|too large|out of range|must be between)/.test(text)) {
    return false
  }
  if (protocol === 'chat') {
    return /max_completion_tokens|reasoning_effort|unsupported (parameter|value)|unknown (parameter|field)|unrecognized/.test(text)
  }
  if (protocol === 'anthropic') {
    return /thinking|adaptive|output_config|budget_tokens|effort|unsupported (parameter|value)|unrecognized/.test(text)
  }
  return false
}

/**
 * 从「输出上限超了」的报错里提取服务端允许的最大值。
 * 报错里常同时出现请求值与上限（如 `max_tokens: 32000 > 8192`），
 * 因此优先取比较符/上限措辞后面的数字，最后才回退到字段名后的数字。
 */
export function extractMaxTokenLimit(message: string): number | null {
  const patterns = [
    // max_tokens: 32000 > 8192 / greater than 8192
    /(?:>|greater than|exceeds?|over)\s*(\d{2,9})/i,
    // must be less than or equal to 16384 / at most 4096 / maximum is 8192
    /(?:less than(?: or equal to)?|at most|maximum(?: is)?|<=|≤|up to)\s*(\d{2,9})/i,
    // 兜底：字段名后的数字
    /(?:max_tokens|max_completion_tokens|max_output_tokens)[^\d]{0,40}(\d{2,9})/i
  ]
  for (const pattern of patterns) {
    const match = message.match(pattern)
    if (match) {
      const value = Number.parseInt(match[1], 10)
      if (Number.isFinite(value) && value > 0) return value
    }
  }
  return null
}

export function buildPromptHeaders(config: PromptAssistConfig): Record<string, string> {
  if (config.protocol === 'anthropic') {
    return {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION
    }
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.apiKey}`
  }
}

/** 拉取模型列表用的请求头：anthropic 需要版本头，其余走 Bearer */
export function buildModelListHeaders(config: Pick<PromptAssistConfig, 'protocol' | 'apiKey'>): Record<string, string> {
  if (config.protocol === 'anthropic') {
    return {
      Accept: 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION
    }
  }
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${config.apiKey}`
  }
}
