import { buildImageEditEndpoint, buildImageEndpoint, buildImageRequestBody, getDefaultImageSize } from '../shared/image-options'
import type { GenerateImageInput } from '../shared/types'
import type { ServerEnv } from './env'

export type ReferenceImagePayload = {
  name: string
  mimeType: string
  data: string
}

export type WebGenerateImageInput = GenerateImageInput & {
  referenceImages?: Array<ReferenceImagePayload | null>
}

type ResponsesApiPayload = {
  output_text?: string
  output?: Array<{ content?: Array<{ text?: string } | string> | string }>
  choices?: Array<{ message?: { content?: string } }>
  error?: { message?: string }
}

let runningRequests = 0
const queuedRequests: Array<() => void> = []

export async function proxyImageGeneration(env: ServerEnv, input: WebGenerateImageInput): Promise<unknown> {
  assertApiKey(env)
  return withConcurrencyLimit(env, async () => {
    const limitedInput = normalizeImageInput(env, input)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), env.requestTimeoutMs)
    try {
      const response = await fetch(buildImageEndpoint(env.baseURL), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.apiKey}`,
          'Content-Type': 'application/json'
        },
        signal: controller.signal,
        body: JSON.stringify(buildImageRequestBody(limitedInput))
      })
      return await readProxyResponse(response, '图片生成失败')
    } finally {
      clearTimeout(timer)
    }
  })
}

export async function proxyImageEdit(env: ServerEnv, input: WebGenerateImageInput): Promise<unknown> {
  assertApiKey(env)
  if (!env.enableImageEdit) throw new Error('当前部署未启用图生图。')
  return withConcurrencyLimit(env, async () => {
    const limitedInput = normalizeImageInput(env, input)
    const formData = new FormData()
    formData.set('prompt', limitedInput.prompt.trim())
    formData.set('model', limitedInput.model.trim())
    formData.set('size', limitedInput.size.trim() || getDefaultImageSize(limitedInput.ratio))
    formData.set('quality', limitedInput.quality)
    formData.set('n', String(limitedInput.n))
    setOptionalFormValue(formData, 'output_format', limitedInput.outputFormat)
    setOptionalFormValue(formData, 'output_compression', limitedInput.outputCompression)
    setOptionalFormValue(formData, 'background', limitedInput.background)
    setOptionalFormValue(formData, 'moderation', limitedInput.moderation)
    setOptionalFormValue(formData, 'partial_images', limitedInput.partialImages)
    setOptionalFormValue(formData, 'input_fidelity', limitedInput.inputFidelity)
    if (limitedInput.maskPngBase64) {
      const maskBuffer = Buffer.from(limitedInput.maskPngBase64.replace(/^data:image\/png;base64,/, ''), 'base64')
      formData.set('mask', new Blob([maskBuffer], { type: 'image/png' }), 'mask.png')
    }
    for (const referenceImage of input.referenceImages || []) {
      if (!referenceImage?.data) continue
      const buffer = Buffer.from(referenceImage.data, 'base64')
      formData.append('image[]', new Blob([buffer], { type: referenceImage.mimeType }), referenceImage.name)
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), env.requestTimeoutMs)
    try {
      const response = await fetch(buildImageEditEndpoint(env.baseURL), {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.apiKey}` },
        signal: controller.signal,
        body: formData
      })
      return await readProxyResponse(response, '图生图失败')
    } finally {
      clearTimeout(timer)
    }
  })
}

export async function proxyPrompt(env: ServerEnv, instruction: string): Promise<string> {
  assertApiKey(env)
  if (!env.enablePromptAssist) throw new Error('当前部署未启用提示词助手。')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), env.requestTimeoutMs)
  try {
    const response = await fetch(`${env.baseURL}/v1/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.apiKey}`,
        'Content-Type': 'application/json'
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: env.promptModel,
        input: [
          { role: 'system', content: '你是专业图像生成提示词助手，输出简洁、具体、可直接用于生成图片的提示词。' },
          { role: 'user', content: instruction }
        ],
        max_output_tokens: 700
      })
    })
    const payload = await readProxyResponse(response, '提示词生成失败') as ResponsesApiPayload
    const text = sanitizePromptText(extractResponseText(payload))
    if (!text) throw new Error('提示词助手没有返回内容。')
    return text
  } finally {
    clearTimeout(timer)
  }
}

function normalizeImageInput(env: ServerEnv, input: WebGenerateImageInput): GenerateImageInput {
  return {
    ...input,
    prompt: input.prompt || '',
    model: input.model?.trim() || env.imageModel,
    size: input.size?.trim() || getDefaultImageSize(input.ratio),
    n: Math.min(env.maxImageCount, Math.max(1, Math.trunc(input.n || 1)))
  }
}

async function withConcurrencyLimit<T>(env: ServerEnv, task: () => Promise<T>): Promise<T> {
  await acquireRequestSlot(env.maxConcurrentRequests)
  try {
    return await task()
  } finally {
    releaseRequestSlot()
  }
}

function acquireRequestSlot(maxConcurrentRequests: number): Promise<void> {
  if (runningRequests < maxConcurrentRequests) {
    runningRequests += 1
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    queuedRequests.push(() => {
      runningRequests += 1
      resolve()
    })
  })
}

function releaseRequestSlot(): void {
  runningRequests = Math.max(0, runningRequests - 1)
  const next = queuedRequests.shift()
  if (next) next()
}

async function readProxyResponse(response: Response, fallbackMessage: string): Promise<unknown> {
  const text = await response.text()
  const payload = parseJsonPayload(text)
  if (!response.ok) {
    const message = getErrorMessage(payload) || `${fallbackMessage}：HTTP ${response.status}`
    throw new Error(message)
  }
  return payload
}

function parseJsonPayload(text: string): unknown {
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

function getErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const error = (payload as { error?: { message?: string } }).error
  return typeof error?.message === 'string' ? error.message : null
}

function assertApiKey(env: ServerEnv): void {
  if (!env.apiKey) throw new Error('服务端未配置 PICTVERSE_API_KEY。')
}

function setOptionalFormValue(formData: FormData, key: string, value: string | number | boolean | null | undefined): void {
  if (value === null || value === undefined || value === '') return
  formData.set(key, String(value))
}

function extractResponseText(payload: ResponsesApiPayload): string {
  if (typeof payload.output_text === 'string') return payload.output_text
  for (const output of payload.output || []) {
    if (typeof output.content === 'string') return output.content
    for (const content of output.content || []) {
      if (typeof content === 'string') return content
      if (typeof content.text === 'string') return content.text
    }
  }
  return payload.choices?.find((choice) => typeof choice.message?.content === 'string')?.message?.content || ''
}

function sanitizePromptText(value: string): string {
  const trimmed = value.trim()
  const fenceMatch = trimmed.match(/^```(?:\w+)?\s*([\s\S]*?)\s*```$/)
  return (fenceMatch?.[1] || trimmed).trim()
}
