import type {
  CapabilityOverride,
  GenerateImageInput,
  ImageBackground,
  ImageInputFidelity,
  ImageModeration,
  ImageOutputFormat,
  ImageQuality,
  ImageRatio
} from './types'

export const DEFAULT_MODEL = 'gpt-image-2.6'
export const DEFAULT_IMAGE_OUTPUT_FORMAT: ImageOutputFormat = 'png'
export const IMAGE_RATIOS: ImageRatio[] = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9', '9:21']
export const IMAGE_QUALITIES: GenerateImageInput['quality'][] = ['auto', 'low', 'medium', 'high']
export const IMAGE_QUALITIES_EXTENDED: GenerateImageInput['quality'][] = ['auto', 'low', 'medium', 'high', 'xhigh', 'max']

/** 2.5 / 2.6 额外支持 xhigh 与 max 质量档 */
export function getImageQualities(model: string): GenerateImageInput['quality'][] {
  const normalized = model.trim().toLowerCase()
  return normalized.startsWith('gpt-image-2.5') || normalized.startsWith('gpt-image-2.6')
    ? IMAGE_QUALITIES_EXTENDED
    : IMAGE_QUALITIES
}

/** 2.6 系列拥有 complexity / SVG / GIF / 色键背景 */
export function isImage26(model: string): boolean {
  return model.trim().toLowerCase().startsWith('gpt-image-2.6')
}

export function isImage25Or26(model: string): boolean {
  return model.trim().toLowerCase().startsWith('gpt-image-2.5') || isImage26(model)
}

/** 存储层的三态覆盖值兜底：脏数据或旧值一律按 auto 处理 */
export function normalizeCapabilityOverride(value: string | null | undefined): CapabilityOverride {
  return value === 'on' || value === 'off' ? value : 'auto'
}

/** 单模型能力：遮罩 / GIF / SVG */
export type ModelCapabilities = { mask: boolean; gif: boolean; svg: boolean }

/** resolveModelCapabilities 需要的供应商字段（只取能力相关，便于测试与复用） */
export type ProviderCapabilityFields = {
  supportsMask: boolean
  supportsGif: boolean
  supportsSvg: boolean
  capabilityMask: CapabilityOverride
  capabilityGif: CapabilityOverride
  capabilitySvg: CapabilityOverride
}

/**
 * 纯按模型名推导能力，不认识返回 null。
 * 只覆盖语义明确的 gpt-image-2.x 系列；其它模型交给供应商字段兜底，
 * 避免给 flux / seedream 之类的中转模型误判。
 */
export function getModelCapabilities(model: string): ModelCapabilities | null {
  const normalized = model.trim().toLowerCase()
  if (!normalized) return null
  if (normalized.startsWith('gpt-image-2.6')) return { mask: true, gif: true, svg: true }
  if (normalized.startsWith('gpt-image-2')) return { mask: true, gif: false, svg: false }
  return null
}

function applyCapabilityOverride(value: boolean, override: CapabilityOverride | undefined): boolean {
  if (override === 'on') return true
  if (override === 'off') return false
  return value
}

/**
 * 最终能力：override(on/off) > 模型名推导 > 供应商 supports_* 兜底。
 * provider 缺失时按「遮罩开、GIF/SVG 关」这一历史默认值处理。
 */
export function resolveModelCapabilities(
  model: string,
  provider?: ProviderCapabilityFields | null
): ModelCapabilities {
  const derived = getModelCapabilities(model)
  const base: ModelCapabilities = derived ?? {
    mask: provider?.supportsMask ?? true,
    gif: provider?.supportsGif ?? false,
    svg: provider?.supportsSvg ?? false
  }
  return {
    mask: applyCapabilityOverride(base.mask, provider?.capabilityMask),
    gif: applyCapabilityOverride(base.gif, provider?.capabilityGif),
    svg: applyCapabilityOverride(base.svg, provider?.capabilitySvg)
  }
}

/**
 * 当前模型可选输出格式。顺序保持既有视觉：2.6 用 IMAGE_OUTPUT_FORMATS_26 的次序，
 * 其它模型沿用 IMAGE_OUTPUT_FORMATS 并在强制开启时追加 svg/gif。
 */
export function getOutputFormatsFor(
  model: string,
  provider?: ProviderCapabilityFields | null
): ImageOutputFormat[] {
  const caps = resolveModelCapabilities(model, provider)
  const order = isImage26(model)
    ? IMAGE_OUTPUT_FORMATS_26
    : [...IMAGE_OUTPUT_FORMATS, 'svg' as const, 'gif' as const]
  return order.filter((format) => (format === 'gif' ? caps.gif : format === 'svg' ? caps.svg : true))
}

export const IMAGE_OUTPUT_FORMATS: ImageOutputFormat[] = ['jpeg', 'png', 'webp']
export const IMAGE_OUTPUT_FORMATS_26: ImageOutputFormat[] = ['png', 'jpeg', 'webp', 'svg', 'gif']
export const IMAGE_BACKGROUNDS: ImageBackground[] = ['auto', 'opaque']
export const IMAGE_BACKGROUNDS_26: ImageBackground[] = ['auto', 'opaque', 'transparent', 'chroma_green', 'chroma_magenta']
export const IMAGE_MODERATIONS: ImageModeration[] = ['auto', 'low']
export const IMAGE_INPUT_FIDELITIES: ImageInputFidelity[] = ['low', 'high']
export const IMAGE_QUALITY_LABELS: Record<ImageQuality, string> = {
  auto: 'auto',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max'
}
export const IMAGE_OUTPUT_FORMAT_LABELS: Record<ImageOutputFormat, string> = {
  png: 'PNG',
  jpeg: 'JPEG',
  webp: 'WebP',
  svg: 'SVG',
  gif: 'GIF'
}
export const IMAGE_BACKGROUND_LABELS: Record<ImageBackground, string> = {
  auto: '自动',
  opaque: '不透明',
  transparent: '透明',
  chroma_green: '绿幕',
  chroma_magenta: '品红'
}
export const IMAGE_MODERATION_LABELS: Record<ImageModeration, string> = {
  auto: '自动',
  low: '低'
}
export const IMAGE_INPUT_FIDELITY_LABELS: Record<ImageInputFidelity, string> = {
  low: '低',
  high: '高'
}

export type ImageSizeOption = {
  value: string
  label: string
}

const imageSizeOptionsByRatio: Record<ImageRatio, ImageSizeOption[]> = {
  '1:1': [
    { value: '1024x1024', label: '标准 1024×1024' },
    { value: '1536x1536', label: '高清 1536×1536' },
    { value: '2048x2048', label: '2K 2048×2048' },
    { value: '2560x2560', label: '高分 2560×2560' }
  ],
  '3:2': [
    { value: '1536x1024', label: '标准 1536×1024' },
    { value: '3072x2048', label: '高分 3072×2048' }
  ],
  '2:3': [
    { value: '1024x1536', label: '标准 1024×1536' },
    { value: '2048x3072', label: '高分 2048×3072' }
  ],
  '4:3': [
    { value: '1024x768', label: '标准 1024×768' },
    { value: '1536x1152', label: '高清 1536×1152' },
    { value: '2048x1536', label: '高分 2048×1536' },
    { value: '3072x2304', label: '高分 3072×2304' }
  ],
  '3:4': [
    { value: '768x1024', label: '标准 768×1024' },
    { value: '1152x1536', label: '高清 1152×1536' },
    { value: '1536x2048', label: '高分 1536×2048' },
    { value: '2304x3072', label: '高分 2304×3072' }
  ],
  '16:9': [
    { value: '1280x720', label: '720P 1280×720' },
    { value: '1536x864', label: '1536×864' },
    { value: '1792x1008', label: '标准 1792×1008' },
    { value: '2048x1152', label: '2K 2048×1152' },
    { value: '2560x1440', label: '2K 2560×1440' },
    { value: '3072x1728', label: '高分 3072×1728' },
    { value: '3840x2160', label: '4K 3840×2160' }
  ],
  '9:16': [
    { value: '720x1280', label: '720P 720×1280' },
    { value: '864x1536', label: '864×1536' },
    { value: '1008x1792', label: '标准 1008×1792' },
    { value: '1152x2048', label: '2K 1152×2048' },
    { value: '1440x2560', label: '2K 1440×2560' },
    { value: '1728x3072', label: '高分 1728×3072' },
    { value: '2160x3840', label: '4K 2160×3840' }
  ],
  '21:9': [
    { value: '1344x576', label: '标准 1344×576' },
    { value: '1792x768', label: '高分 1792×768' },
    { value: '2240x960', label: '高分 2240×960' },
    { value: '2688x1152', label: '高分 2688×1152' },
    { value: '3136x1344', label: '高分 3136×1344' },
    { value: '3584x1536', label: '高分 3584×1536' }
  ],
  '9:21': [
    { value: '576x1344', label: '标准 576×1344' },
    { value: '768x1792', label: '高分 768×1792' },
    { value: '960x2240', label: '高分 960×2240' },
    { value: '1152x2688', label: '高分 1152×2688' },
    { value: '1344x3136', label: '高分 1344×3136' },
    { value: '1536x3584', label: '高分 1536×3584' }
  ]
}

export function getImageSizeOptions(ratio: ImageRatio): ImageSizeOption[] {
  return imageSizeOptionsByRatio[ratio]
}

export function getDefaultImageSize(ratio: ImageRatio): string {
  return getImageSizeOptions(ratio).find((option) => option.label.startsWith('标准'))?.value
    || getImageSizeOptions(ratio)[0]?.value
    || ratioToSize(ratio)
}

export function isImageSizeCompatible(ratio: ImageRatio, size: string): boolean {
  return getImageSizeOptions(ratio).some((option) => option.value === size)
}

const ratioSizeMap: Record<ImageRatio, string> = {
  '1:1': '1024x1024',
  '3:2': '1536x1024',
  '2:3': '1024x1536',
  '4:3': '1024x768',
  '3:4': '768x1024',
  '16:9': '1792x1008',
  '9:16': '1008x1792',
  '21:9': '1344x576',
  '9:21': '576x1344'
}

export function ratioToSize(ratio: ImageRatio): string {
  return ratioSizeMap[ratio]
}

export function formatImageQuality(quality: ImageQuality): string {
  return IMAGE_QUALITY_LABELS[quality] || quality
}

export function formatImageSize(size: string): string {
  return size.replace('x', '×')
}

function toOptionalNumber(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function buildImageEndpoint(baseURL: string): string {
  const normalized = baseURL.trim().replace(/\/+$/, '')
  return `${normalized}/v1/images/generations`
}

export function buildImageEditEndpoint(baseURL: string): string {
  const normalized = baseURL.trim().replace(/\/+$/, '')
  return `${normalized}/v1/images/edits`
}

export function supportsImageInputFidelity(model: string): boolean {
  return !model.trim().toLowerCase().startsWith('gpt-image-2')
}

export function buildImageRequestBody(input: GenerateImageInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: input.prompt.trim(),
    model: input.model.trim() || DEFAULT_MODEL,
    size: input.size.trim() || getDefaultImageSize(input.ratio),
    quality: input.quality,
    n: Math.min(10, Math.max(1, input.n || 1))
  }
  if (input.outputFormat) body.output_format = input.outputFormat
  if (toOptionalNumber(input.outputCompression) != null) body.output_compression = input.outputCompression
  if (input.background) body.background = input.background
  if (input.moderation) body.moderation = input.moderation
  if (input.stream) body.stream = true
  if (toOptionalNumber(input.partialImages) != null) body.partial_images = input.partialImages
  // 2.6 专属参数
  if (input.complexity) body.complexity = input.complexity
  if (toOptionalNumber(input.frameCount) != null) body.frame_count = input.frameCount
  if (toOptionalNumber(input.frameDurationMs) != null) body.frame_duration_ms = input.frameDurationMs
  if (toOptionalNumber(input.seed) != null) body.seed = input.seed
  return body
}

/** 按供应商价格配置估算本次生成费用（元）。无法估算时返回 null。 */
export function estimateGenerationCost(
  provider: { pricingMode: string; priceUnified: number | null; price1K: number | null; price2K: number | null; price4K: number | null } | null,
  size: string,
  count: number
): number | null {
  if (!provider) return null
  const pixels = parseSizePixels(size)
  const tier = pixels == null ? null : pixels >= 3840 * 2160 ? 4 : pixels >= 2048 * 2048 ? 2 : 1

  if (provider.pricingMode === 'unified') {
    return provider.priceUnified != null ? round2(provider.priceUnified * count) : null
  }
  if (provider.pricingMode === 'tiered') {
    const unit = tier === 4 ? provider.price4K : tier === 2 ? provider.price2K : provider.price1K
    return unit != null ? round2(unit * count) : null
  }
  return null
}

function parseSizePixels(size: string): number | null {
  const match = /^(\d+)x(\d+)$/i.exec(size.trim())
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  return width * height
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
