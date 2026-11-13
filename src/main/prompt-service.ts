import type { PromptAssistInput, PromptAssistantProtocol } from '@shared/types'
import {
  buildContextBudgetNote,
  buildPromptHeaders,
  buildPromptRequestBody,
  normalizePromptAssistConfig,
  PROMPT_PROTOCOL_ENDPOINTS,
  type PromptAssistConfig
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

const SYSTEM_PROMPT = '你是专业图像生成提示词助手，输出简洁、具体、可直接用于生成图片的提示词。'

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
    const system = SYSTEM_PROMPT + buildContextBudgetNote(config)
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: buildPromptHeaders(config),
      body: JSON.stringify(buildPromptRequestBody(config, system, instruction))
    })
    const responseText = await response.text()
    const text = extractResponseText(config.protocol, responseText)

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
