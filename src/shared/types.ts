export type ImageRatio = '1:1' | '3:2' | '2:3' | '4:3' | '3:4' | '16:9' | '9:16' | '21:9' | '9:21'
export type ImageQuality = 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type ImageOutputFormat = 'png' | 'jpeg' | 'webp' | 'svg' | 'gif'
export type ImageBackground = 'auto' | 'opaque' | 'transparent' | 'chroma_green' | 'chroma_magenta'
export type ImageModeration = 'auto' | 'low'
export type ImageInputFidelity = 'low' | 'high'
export type ImageStatus = 'succeeded' | 'failed'
export type GenerationRunStatus = 'running' | ImageStatus
export type GenerationMode = 'text-to-image' | 'image-to-image'

export type ReferenceImage = {
  id: string
  name: string
  mimeType: string
  filePath: string | null
  fileSizeBytes: number
  createdAt: string
}

export type ReferenceImageImportFile = {
  name: string
  mimeType: string
  data: ArrayBuffer
}

export type GenerateImageInput = {
  conversationId: string
  prompt: string
  model: string
  ratio: ImageRatio
  size: string
  quality: ImageQuality
  n: number
  outputFormat?: ImageOutputFormat
  outputCompression?: number
  background?: ImageBackground
  moderation?: ImageModeration
  stream?: boolean
  partialImages?: number
  inputFidelity?: ImageInputFidelity
  complexity?: ImageComplexity
  frameCount?: number
  frameDurationMs?: number
  seed?: number
  providerId?: string
  maskPngBase64?: string
  /** 遮罩对应的参考图 id：images/edits 只把 mask 作用在第一张图上，发送时需要把它排到最前 */
  maskReferenceId?: string
  referenceImageIds?: string[]
}

export type PromptAssistantProtocol = 'chat' | 'responses' | 'anthropic'

/**
 * 提示词助手的完整配置。
 * 与 @shared/prompt-assistant 的 PromptAssistConfig 保持同构；
 * 上下文/输出长度存用户输入原文（如 1m / 1k / 1000），请求前按语义解析。
 */
export type PromptAssistantConfig = {
  /** 服务商名称，仅展示用 */
  name: string
  baseURL: string
  apiKey: string
  model: string
  protocol: PromptAssistantProtocol
  /** 上下文长度输入原文（1m=100万 / 1k=1千 / 纯数字=本身），空表示跟随默认 */
  contextTokenText: string
  /** 输出长度输入原文（1m=100万 / 1k=1千 / 纯数字=本身），空表示跟随默认 */
  maxOutputTokenText: string
  /** 思考强度：off / low / medium / high / xhigh / max；chat 协议映射 reasoning_effort，anthropic 映射 thinking budget */
  reasoning: 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  /** 角色提示词：助手人设/风格，空时回退内置 */
  rolePrompt: string
  /** 系统提示词：整段指令，空时回退内置 */
  systemPrompt: string
}

export type PromptAssistInput = {
  prompt?: string
  hasReferenceImages?: boolean
  /** 提示词助手的完整配置，由渲染层从本地设置传入 */
  config?: Partial<PromptAssistantConfig>
}

export type ImageComplexity = 'low' | 'medium' | 'high'

export type Conversation = {
  id: string
  title: string
  draftPrompt: string
  model: string
  providerId: string | null
  ratio: ImageRatio
  size: string
  quality: ImageQuality
  n: number
  outputFormat: ImageOutputFormat
  outputCompression: number | null
  background: ImageBackground
  moderation: ImageModeration
  stream: boolean
  partialImages: number | null
  inputFidelity: ImageInputFidelity | null
  complexity: ImageComplexity | null
  frameCount: number | null
  frameDurationMs: number | null
  seed: number | null
  seedLocked: boolean
  autoSaveHistory: boolean
  keepFailureDetails: boolean
  referenceImages: ReferenceImage[]
  createdAt: string
  updatedAt: string
}

export type ConversationUpdate = Partial<
  Pick<
    Conversation,
    | 'title'
    | 'draftPrompt'
    | 'model'
    | 'providerId'
    | 'ratio'
    | 'size'
    | 'quality'
    | 'n'
    | 'outputFormat'
    | 'outputCompression'
    | 'background'
    | 'moderation'
    | 'stream'
    | 'partialImages'
    | 'inputFidelity'
    | 'complexity'
    | 'frameCount'
    | 'frameDurationMs'
    | 'seed'
    | 'seedLocked'
    | 'autoSaveHistory'
    | 'keepFailureDetails'
  >
>

export type ConversationCreateInput = Partial<
  Pick<
    Conversation,
    | 'model'
    | 'providerId'
    | 'ratio'
    | 'size'
    | 'quality'
    | 'n'
    | 'outputFormat'
    | 'outputCompression'
    | 'background'
    | 'moderation'
    | 'stream'
    | 'partialImages'
    | 'inputFidelity'
    | 'complexity'
    | 'frameCount'
    | 'frameDurationMs'
    | 'seed'
    | 'seedLocked'
    | 'autoSaveHistory'
    | 'keepFailureDetails'
  >
>

export type ImageHistoryItem = {
  id: string
  conversationId: string | null
  runId: string | null
  prompt: string
  model: string
  ratio: ImageRatio
  size: string | null
  quality: ImageQuality
  requestIndex: number | null
  durationMs: number | null
  filePath: string | null
  fileSizeBytes: number | null
  status: ImageStatus
  errorMessage: string | null
  errorDetails: string | null
  favorite: boolean
  generationMode: GenerationMode
  referenceImages: ReferenceImage[]
  createdAt: string
}

export type GenerationRun = {
  id: string
  conversationId: string
  prompt: string
  model: string
  ratio: ImageRatio
  size: string | null
  quality: ImageQuality
  n: number
  status: GenerationRunStatus
  durationMs: number | null
  errorMessage: string | null
  errorDetails: string | null
  generationMode: GenerationMode
  referenceImages: ReferenceImage[]
  createdAt: string
  items: ImageHistoryItem[]
}

export type ProviderSettings = {
  baseURL: string
  apiKeyStored: boolean
  defaultModel: string
  promptModel: string
  insecureStorage: boolean
  /** 配置的图片根目录，空字符串 = 默认目录 */
  imagesRoot: string
  /** 实际生效的图片根目录绝对路径 */
  imagesRootEffective: string
}

export type ProviderSettingsUpdate = {
  baseURL?: string
  apiKey?: string | null
  defaultModel?: string
  promptModel?: string
  /** 空 / null = 恢复默认目录 */
  imagesRoot?: string | null
}

export type GenerateImageResult = {
  run: GenerationRun
  items: ImageHistoryItem[]
  errorMessage?: string
  errorDetails?: string
  canceled?: boolean
}

export type BatchDownloadResult = {
  directory: string
  saved: number
  skipped: number
}

export type HistoryListOptions = {
  query?: string
  sort?: 'newest' | 'oldest'
  favoritesOnly?: boolean
}

export type PricingMode = 'unified' | 'tiered' | 'token'

/**
 * 能力覆盖档位：auto 跟随模型名推导，on/off 强制启用或关闭。
 * 只有 auto 且模型名无法识别时，才回落到 supportsMask / supportsGif / supportsSvg。
 */
export type CapabilityOverride = 'auto' | 'on' | 'off'

export type Provider = {
  id: string
  name: string
  baseURL: string
  apiKey: string | null
  defaultModel: string
  promptModel: string | null
  /** 模型名无法识别时的默认能力；可识别时由模型推导决定 */
  supportsMask: boolean
  supportsGif: boolean
  supportsSvg: boolean
  capabilityMask: CapabilityOverride
  capabilityGif: CapabilityOverride
  capabilitySvg: CapabilityOverride
  pricingMode: PricingMode
  priceUnified: number | null
  price1K: number | null
  price2K: number | null
  price4K: number | null
  rateTextInput: number | null
  rateImageInput: number | null
  rateImageOutput: number | null
  isDefault: boolean
  position: number
  createdAt: string
  updatedAt: string
}

export type ProviderInput = Partial<Omit<Provider, 'id' | 'createdAt' | 'updatedAt'>>

export type ProviderModel = {
  providerId: string
  modelId: string
  added: boolean
  position: number
}

export type PictVerseAPI = {
  provider: {
    list: () => Promise<Provider[]>
    create: (input: ProviderInput) => Promise<Provider>
    update: (id: string, input: ProviderInput) => Promise<Provider>
    remove: (id: string) => Promise<void>
    setDefault: (id: string) => Promise<Provider[]>
    models: (providerId: string) => Promise<ProviderModel[]>
    fetchModels: (providerId: string) => Promise<string[]>
    saveModels: (providerId: string, modelIds: string[]) => Promise<ProviderModel[]>
  }
  settings: {
    get: () => Promise<ProviderSettings>
    update: (input: ProviderSettingsUpdate) => Promise<ProviderSettings>
    /** 桌面版可用：弹出系统目录选择框；Web 版未实现 */
    chooseImagesRoot?: () => Promise<string | null>
  }
  conversation: {
    list: () => Promise<Conversation[]>
    create: (input?: ConversationCreateInput) => Promise<Conversation>
    update: (id: string, input: ConversationUpdate) => Promise<Conversation>
    delete: (id: string) => Promise<void>
    runs: (id: string) => Promise<GenerationRun[]>
  }
  image: {
    generate: (input: GenerateImageInput) => Promise<GenerateImageResult>
    cancel: (runId: string, requestIndex?: number) => Promise<void>
    /** width > 0 时请求缩略图（最长边按 width 等比缩放）；不传或 <= 0 返回原图 */
    url: (id: string, width?: number) => string
    copy: (id: string) => Promise<void>
    download: (id: string) => Promise<string | null>
    downloadMany: (ids: string[]) => Promise<BatchDownloadResult | null>
  }
  prompt: {
    inspire: (input?: PromptAssistInput) => Promise<string>
    enrich: (input: PromptAssistInput & { prompt: string }) => Promise<string>
  }
  reference: {
    importFiles: (conversationId: string, files: ReferenceImageImportFile[]) => Promise<ReferenceImage[]>
    addFromHistory: (conversationId: string, historyId: string) => Promise<ReferenceImage[]>
    remove: (conversationId: string, referenceImageId: string) => Promise<ReferenceImage[]>
    reorder: (conversationId: string, referenceImageIds: string[]) => Promise<ReferenceImage[]>
    url: (id: string) => string
  }
  history: {
    list: (options?: HistoryListOptions) => Promise<ImageHistoryItem[]>
    delete: (id: string) => Promise<void>
    favorite: (id: string, favorite: boolean) => Promise<ImageHistoryItem>
  }
  shell: {
    openPath: (filePath: string) => Promise<string>
    openExternal: (url: string) => Promise<void>
  }
  /** 桌面版可用：自绘窗口控制（最小化/最大化/关闭）；Web 版未实现 */
  window?: {
    minimize: () => void
    toggleMaximize: () => void
    close: () => void
    isMaximized: () => boolean
    /** 订阅最大化状态变化，返回取消订阅函数 */
    onMaximizeChange: (callback: (isMaximized: boolean) => void) => () => void
  }
}
