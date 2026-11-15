/**
 * 把「会话默认参数 + 本次调用覆盖」收敛成一次生成请求。
 *
 * 口径对齐渲染层 app-store 的 generate：比例/尺寸/质量/格式都必须落在该模型
 * 支持的集合内，否则上游会直接 400。MCP 的入参来自外部 agent，不能假设合法。
 */
import {
  DEFAULT_IMAGE_OUTPUT_FORMAT,
  getDefaultImageSize,
  getImageQualities,
  getOutputFormatsFor,
  isImageSizeCompatible,
  normalizeImageRatio,
  resolveModelCapabilities
} from '@shared/image-options'
import type {
  Conversation,
  GenerateImageInput,
  ImageBackground,
  ImageModeration,
  ImageOutputFormat,
  ImageQuality
} from '@shared/types'

export type GenerateOverrides = {
  prompt?: string
  model?: string
  ratio?: string
  size?: string
  quality?: string
  n?: number
  outputFormat?: string
  background?: string
  moderation?: string
  seed?: number
  referenceImageIds?: string[]
}

export type NormalizeResult = { ok: true; input: GenerateImageInput } | { ok: false; error: string }

const BACKGROUNDS_26: ImageBackground[] = ['auto', 'opaque', 'transparent', 'chroma_green', 'chroma_magenta']
const BACKGROUNDS: ImageBackground[] = ['auto', 'opaque']
const MODERATIONS: ImageModeration[] = ['auto', 'low']

export function buildGenerateInput(conversation: Conversation, overrides: GenerateOverrides): NormalizeResult {
  const prompt = (overrides.prompt ?? conversation.draftPrompt).trim()
  if (!prompt) return { ok: false, error: 'prompt 不能为空：请先给出提示词，或先在会话里写好草稿。' }

  const model = (overrides.model ?? conversation.model).trim()
  if (!model) return { ok: false, error: 'model 为空：请指定模型，或先给供应商设置默认模型。' }

  const ratio = normalizeImageRatio(overrides.ratio ?? conversation.ratio)
  const requestedSize = (overrides.size ?? conversation.size ?? '').trim()
  // 尺寸与最终比例不匹配时回退到该比例的标准档，避免上游 400
  const size = requestedSize && isImageSizeCompatible(ratio, requestedSize)
    ? requestedSize
    : getDefaultImageSize(ratio)

  const qualities = getImageQualities(model)
  const requestedQuality = (overrides.quality ?? conversation.quality) as ImageQuality
  const quality: ImageQuality = qualities.includes(requestedQuality) ? requestedQuality : 'high'

  const formats = getOutputFormatsFor(model)
  const requestedFormat = (overrides.outputFormat ?? conversation.outputFormat) as ImageOutputFormat
  const outputFormat: ImageOutputFormat = formats.includes(requestedFormat) ? requestedFormat : DEFAULT_IMAGE_OUTPUT_FORMAT

  const backgrounds = model.toLowerCase().startsWith('gpt-image-2.6') ? BACKGROUNDS_26 : BACKGROUNDS
  const requestedBackground = (overrides.background ?? conversation.background) as ImageBackground
  const background: ImageBackground = backgrounds.includes(requestedBackground) ? requestedBackground : 'auto'

  const requestedModeration = (overrides.moderation ?? conversation.moderation) as ImageModeration
  const moderation: ImageModeration = MODERATIONS.includes(requestedModeration) ? requestedModeration : 'auto'

  const n = clampInt(overrides.n ?? conversation.n, 1, 10)
  const seed = normalizeSeed(overrides.seed ?? (conversation.seedLocked ? conversation.seed : null))
  const referenceImageIds = overrides.referenceImageIds?.length
    ? dedupe(overrides.referenceImageIds).slice(0, 8)
    : conversation.referenceImages.map((reference) => reference.id)

  return {
    ok: true,
    input: {
      conversationId: conversation.id,
      prompt,
      model,
      ratio,
      size,
      quality,
      n,
      outputFormat,
      outputCompression: conversation.outputCompression ?? undefined,
      background,
      moderation,
      // 流式对 MCP 没有意义：一次性拿完整结果更省事
      stream: false,
      inputFidelity: conversation.inputFidelity ?? undefined,
      complexity: conversation.complexity ?? undefined,
      frameCount: conversation.frameCount ?? undefined,
      frameDurationMs: conversation.frameDurationMs ?? undefined,
      seed: seed ?? undefined,
      providerId: conversation.providerId ?? undefined,
      referenceImageIds
    }
  }
}

/** 摘要模型能力，供 list_models 与参数校验复用 */
export function describeModelCapabilities(model: string): { mask: boolean; gif: boolean; svg: boolean } {
  return resolveModelCapabilities(model, null)
}

function clampInt(value: unknown, min: number, max: number): number {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : min
  return Math.min(max, Math.max(min, parsed))
}

function normalizeSeed(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(0, Math.trunc(value))
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => typeof value === 'string' && value.trim())))
}
