import type { PromptAssistInput, PromptAssistantProtocol } from '@shared/types'
import {
  buildContextBudgetNote,
  buildPromptHeaders,
  buildPromptRequestBody,
  buildSystemPrompt,
  extractMaxTokenLimit,
  normalizePromptAssistConfig,
  parseTokenAmount,
  resolveMaxOutputTokens,
  shouldRetryWithLegacy,
  PROMPT_PROTOCOL_ENDPOINTS,
  type PromptAssistConfig,
  type PromptWireMode
} from '@shared/prompt-assistant'
import type { SettingsStore } from './settings'

type ChatCompletionsPayload = {
  choices?: Array<{ message?: { content?: string } }>
  error?: { message?: string }
}

type ResponsesApiPayload = {
  output_text?: string
  output?: Array<{ content?: Array<{ text?: string } | string> | string }>
  error?: { message?: string }
}

type AnthropicPayload = {
  content?: Array<{ type?: string; text?: string }>
  error?: { message?: string }
}

export class PromptService {
  constructor(private readonly settings: SettingsStore) {}

  inspire(input: PromptAssistInput = {}): Promise<string> {
    return this.requestPrompt([
      '请生成一条可直接用于图像生成的中文提示词。',
      '提示词需要包含主体、场景、构图、光线、风格、细节与氛围。',
      input.hasReferenceImages ? '当前会话包含参考图，请提示保留参考图主体和风格方向。' : '',
      '只输出提示词正文，不要解释，不要加标题。'
    ].filter(Boolean).join('\n'), input.config)
  }

  enrich(input: PromptAssistInput & { prompt: string }): Promise<string> {
    const prompt = input.prompt.trim()
    if (!prompt) throw new Error('Prompt is required.')
    return this.requestPrompt([
      '请丰富并优化下面的图像生成提示词。',
      '保持用户原意和核心主体不变，跟随原提示词语言输出。',
      '补充视觉细节、镜头/构图、材质、光影、风格描述。',
      input.hasReferenceImages ? '当前会话包含参考图，请保留参考图主体和风格方向。' : '',
      '只输出优化后的提示词正文，不要解释，不要加标题。',
      '',
      prompt
    ].filter((line) => line !== '').join('\n'), input.config)
  }

  private async requestPrompt(instruction: string, rawConfig?: Partial<PromptAssistConfig>): Promise<string> {
    const config = this.resolveConfig(rawConfig)
    if (!config.apiKey) throw new Error('提示词服务的 API Key 尚未配置，请到设置 → 提示词助手填写。')

    const endpoint = PROMPT_PROTOCOL_ENDPOINTS[config.protocol](config.baseURL)
    // 只有用户显式填了上下文才注入预算注记；默认 256k 不该变成「请保持紧凑」的噪音
    const explicitContextTokens = parseTokenAmount(config.contextTokenText) ?? 0
    const system = buildSystemPrompt(config) + buildContextBudgetNote(explicitContextTokens)

    const attempt = async (wire: PromptWireMode, maxTokensOverride?: number) => {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: buildPromptHeaders(config),
        body: JSON.stringify(buildPromptRequestBody(config, system, instruction, wire, maxTokensOverride))
      })
      return { response, responseText: await response.text() }
    }

    let wire: PromptWireMode = 'modern'
    let { response, responseText } = await attempt(wire)
    let message = extractResponseText(config.protocol, responseText)

    // 输出上限超过模型能力时，按服务端给出的上限收敛重试一次（沿用当前写法）
    if (!response.ok && (response.status === 400 || response.status === 422)) {
      const limit = extractMaxTokenLimit(message)
      if (limit && limit < resolveMaxOutputTokens(config)) {
        ;({ response, responseText } = await attempt(wire, limit))
        message = extractResponseText(config.protocol, responseText)
      }
    }

    // 老模型 / 老网关不认新参数时，按 legacy 写法重试一次
    if (!response.ok && shouldRetryWithLegacy(config.protocol, response.status, message)) {
      wire = 'legacy'
      ;({ response, responseText } = await attempt(wire))
      message = extractResponseText(config.protocol, responseText)
    }

    const text = message

    if (!response.ok) {
      throw new Error(text || `提示词生成失败：HTTP ${response.status}`)
    }
    const prompt = sanitizePromptText(text)
    if (!prompt) throw new Error('提示词生成没有返回文本。')
    return prompt
  }

  /** 配置优先级：渲染层传入的 config > 全局默认模型回填 */
  private resolveConfig(rawConfig?: Partial<PromptAssistConfig>): PromptAssistConfig {
    const config = normalizePromptAssistConfig(rawConfig)
    if (!rawConfig?.apiKey) {
      const fallbackKey = this.settings.getApiKey()
      if (fallbackKey && !config.apiKey) {
        return { ...config, apiKey: fallbackKey }
      }
    }
    return config
  }
}

function extractResponseText(protocol: PromptAssistantProtocol, responseText: string): string {
  const payload = parsePayload(responseText)
  if (payload.error?.message) return payload.error.message

  if (protocol === 'anthropic') {
    const chunks = (payload as AnthropicPayload).content || []
    return chunks.map((chunk) => (typeof chunk?.text === 'string' ? chunk.text : '')).join('').trim()
  }
  if (protocol === 'responses') {
    const p = payload as ResponsesApiPayload
    if (typeof p.output_text === 'string') return p.output_text
    for (const output of p.output || []) {
      if (typeof output.content === 'string') return output.content
      for (const content of output.content || []) {
        if (typeof content === 'string') return content
        if (typeof content.text === 'string') return content.text
      }
    }
    return ''
  }
  // chat
  const p = payload as ChatCompletionsPayload
  return p.choices?.find((choice) => typeof choice.message?.content === 'string')?.message?.content || ''
}

function parsePayload(responseText: string): { error?: { message?: string } } & Record<string, unknown> {
  if (!responseText.trim()) return {}
  try {
    return JSON.parse(responseText) as { error?: { message?: string } } & Record<string, unknown>
  } catch {
    return {}
  }
}

function sanitizePromptText(value: string): string {
  const trimmed = value.trim()
  const fenceMatch = trimmed.match(/^```(?:\w+)?\s*([\s\S]*?)\s*```$/)
  return (fenceMatch?.[1] || trimmed).trim()
}
