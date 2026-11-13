import { DEFAULT_IMAGE_OUTPUT_FORMAT, DEFAULT_MODEL, getDefaultImageSize, normalizeCapabilityOverride } from '@shared/image-options'
import { DEFAULT_PROMPT_MODEL } from '@shared/prompt-options'
import type {
  BatchDownloadResult,
  Conversation,
  ConversationCreateInput,
  ConversationUpdate,
  GenerateImageInput,
  GenerateImageResult,
  GenerationMode,
  GenerationRun,
  HistoryListOptions,
  ImageHistoryItem,
  ImageOutputFormat,
  PictVerseAPI,
  PromptAssistInput,
  Provider,
  ProviderInput,
  ProviderModel,
  ProviderSettings,
  ProviderSettingsUpdate,
  ReferenceImage,
  ReferenceImageImportFile
} from '@shared/types'
import {
  deleteRecord,
  findImageBlobByHistoryId,
  findReferenceBlobByReferenceId,
  getRecord,
  listConversationsFromDB,
  listRecords,
  listRunsFromDB,
  putRecord,
  type WebImageBlobRecord,
  type WebReferenceBlobRecord
} from './web-db'

type WebConfig = {
  baseURL: string
  defaultModel: string
  promptModel: string
  apiKeyStored: boolean
  maxImageCount: number
  imageEditEnabled: boolean
  promptAssistEnabled: boolean
}

type ImageProxyResponse = {
  data?: Array<{ b64_json?: string; url?: string }>
  error?: { message?: string }
}

const 图片地址缓存 = new Map<string, string>()
const 参考图地址缓存 = new Map<string, string>()

/**
 * 生成 UUID v4
 * 兼容 HTTP 环境（非 HTTPS 或非 localhost 时 crypto.randomUUID 不可用）
 * @returns UUID 字符串，格式为 xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
 */
function generateUUID(): string {
  // 降级方案：直接使用 Math.random 生成 UUID v4
  // 不尝试调用 crypto.randomUUID，因为在 HTTP 环境下它会抛出 SecurityError
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.random() * 16 | 0
    const value = char === 'x' ? random : (random & 0x3 | 0x8)
    return value.toString(16)
  })
}

const 默认配置: WebConfig = {
  baseURL: '由服务器环境变量配置',
  defaultModel: DEFAULT_MODEL,
  promptModel: DEFAULT_PROMPT_MODEL,
  apiKeyStored: true,
  maxImageCount: 4,
  imageEditEnabled: true,
  promptAssistEnabled: true
}

/**
 * 读取时归一化三态值：IndexedDB 里可能存有 '' / 'ON' / 0 之类的脏值，
 * 与 SQLite 侧的 normalizeCapabilityOverride 保持同一语义，避免角标渲染成空框。
 */
function normalizeProvider(provider: Provider): Provider {
  return {
    ...provider,
    capabilityMask: normalizeCapabilityOverride(provider.capabilityMask),
    capabilityGif: normalizeCapabilityOverride(provider.capabilityGif),
    capabilitySvg: normalizeCapabilityOverride(provider.capabilitySvg)
  }
}

async function listProviders(): Promise<Provider[]> {
  const rows = await listRecords<Provider>('providers')
  return rows
    .map(normalizeProvider)
    .sort((left, right) => left.position - right.position)
}

async function createProvider(input: ProviderInput): Promise<Provider> {
  const existing = await listProviders()
  const now = new Date().toISOString()
  const provider: Provider = {
    id: generateUUID(),
    name: input.name?.trim() || '未命名供应商',
    baseURL: input.baseURL?.trim() || '',
    apiKey: input.apiKey ?? null,
    defaultModel: input.defaultModel?.trim() || DEFAULT_MODEL,
    promptModel: input.promptModel ?? null,
    supportsMask: input.supportsMask ?? true,
    supportsGif: input.supportsGif ?? false,
    supportsSvg: input.supportsSvg ?? false,
    capabilityMask: input.capabilityMask ?? 'auto',
    capabilityGif: input.capabilityGif ?? 'auto',
    capabilitySvg: input.capabilitySvg ?? 'auto',
    pricingMode: input.pricingMode ?? 'unified',
    priceUnified: input.priceUnified ?? null,
    price1K: input.price1K ?? null,
    price2K: input.price2K ?? null,
    price4K: input.price4K ?? null,
    rateTextInput: input.rateTextInput ?? null,
    rateImageInput: input.rateImageInput ?? null,
    rateImageOutput: input.rateImageOutput ?? null,
    isDefault: input.isDefault ?? existing.length === 0,
    position: existing.length,
    createdAt: now,
    updatedAt: now
  }
  return putRecord('providers', provider)
}

async function updateProvider(id: string, input: ProviderInput): Promise<Provider> {
  const current = await getRecord<Provider>('providers', id)
  if (!current) throw new Error('供应商不存在。')
  const next: Provider = {
    ...current,
    ...input,
    name: input.name?.trim() ?? current.name,
    baseURL: input.baseURL?.trim() ?? current.baseURL,
    defaultModel: input.defaultModel?.trim() ?? current.defaultModel,
    // 旧记录没有这三列，读出来时补默认值，避免界面拿到 undefined
    capabilityMask: input.capabilityMask ?? current.capabilityMask ?? 'auto',
    capabilityGif: input.capabilityGif ?? current.capabilityGif ?? 'auto',
    capabilitySvg: input.capabilitySvg ?? current.capabilitySvg ?? 'auto',
    updatedAt: new Date().toISOString()
  }
  if (next.isDefault) {
    const others = await listProviders()
    await Promise.all(
      others
        .filter((item) => item.id !== next.id && item.isDefault)
        .map((item) => putRecord('providers', { ...item, isDefault: false }))
    )
  }
  return putRecord('providers', next)
}

async function removeProvider(id: string): Promise<void> {
  await deleteRecord('providers', id)
}

async function setDefaultProvider(id: string): Promise<Provider[]> {
  const providers = await listProviders()
  await Promise.all(providers.map((item) => putRecord('providers', { ...item, isDefault: item.id === id })))
  return listProviders()
}

async function listProviderModels(providerId: string): Promise<ProviderModel[]> {
  const rows = await listRecords<ProviderModel>('providerModels')
  return rows.filter((row) => row.providerId === providerId).sort((left, right) => left.position - right.position)
}

async function saveProviderModels(providerId: string, modelIds: string[]): Promise<ProviderModel[]> {
  const existing = await listProviderModels(providerId)
  await Promise.all(existing.map((row) => deleteRecord('providerModels', `${providerId}:${row.modelId}`)))
  await Promise.all(
    modelIds.map((modelId, index) =>
      putRecord('providerModels', { id: `${providerId}:${modelId}`, providerId, modelId, added: true, position: index })
    )
  )
  return listProviderModels(providerId)
}

async function fetchProviderModels(providerId: string): Promise<string[]> {
  const providers = await listProviders()
  const provider = providers.find((item) => item.id === providerId)
  if (!provider) throw new Error('供应商不存在。')
  const base = provider.baseURL.trim().replace(/\/+$/, '')
  if (!base) throw new Error('供应商未配置 Base URL。')
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`
  const response = await fetch(`${base}/v1/models`, { headers })
  if (!response.ok) throw new Error(`获取模型失败：HTTP ${response.status}`)
  const payload: unknown = await response.json()
  const data = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)
      ? ((payload as { data: unknown[] }).data)
      : []
  return data
    .map((entry) => (typeof entry === 'string' ? entry : entry && typeof entry === 'object' ? (entry as { id?: string }).id : null))
    .filter((id): id is string => Boolean(id))
}

export function createWebPictVerseAPI(): PictVerseAPI {
  return {
    provider: {
      list: listProviders,
      create: createProvider,
      update: updateProvider,
      remove: removeProvider,
      setDefault: setDefaultProvider,
      models: listProviderModels,
      fetchModels: fetchProviderModels,
      saveModels: saveProviderModels
    },
    settings: {
      get: getSettings,
      update: updateSettings
    },
    conversation: {
      list: listConversations,
      create: createConversation,
      update: updateConversation,
      delete: deleteConversation,
      runs: listRuns
    },
    image: {
      generate: generateImage,
      cancel: async () => undefined,
      url: (id: string) => 图片地址缓存.get(id) || '',
      copy: copyImage,
      download: downloadImage,
      downloadMany: downloadManyImages
    },
    prompt: {
      inspire: (input?: PromptAssistInput) => requestPrompt('/api/responses/inspire', input || {}),
      enrich: (input: PromptAssistInput & { prompt: string }) => requestPrompt('/api/responses/enrich', input)
    },
    reference: {
      importFiles: importReferenceFiles,
      addFromHistory,
      remove: removeReferenceImage,
      reorder: reorderReferenceImages,
      url: (id: string) => 参考图地址缓存.get(id) || ''
    },
    history: {
      list: listHistory,
      delete: deleteHistory,
      favorite: setFavorite
    },
    shell: {
      openPath: async () => 'Web 端不支持打开本地文件路径。',
      openExternal: async (url: string) => {
        window.open(url, '_blank', 'noopener,noreferrer')
      }
    }
  }
}

async function getSettings(): Promise<ProviderSettings> {
  const config = await getServerConfig()
  return {
    baseURL: config.baseURL,
    apiKeyStored: config.apiKeyStored,
    defaultModel: config.defaultModel,
    promptModel: config.promptModel,
    insecureStorage: false,
    imagesRoot: '',
    imagesRootEffective: ''
  }
}

async function updateSettings(input: ProviderSettingsUpdate): Promise<ProviderSettings> {  const current = await getSettings()
  const next: ProviderSettings = {
    ...current,
    defaultModel: input.defaultModel?.trim() || current.defaultModel,
    promptModel: input.promptModel?.trim() || current.promptModel,
    apiKeyStored: true
  }
  await putRecord('settings', { id: 'provider', defaultModel: next.defaultModel, promptModel: next.promptModel })
  return next
}

async function getServerConfig(): Promise<WebConfig> {
  const local = await getRecord<ProviderSettings>('settings', 'provider')
  try {
    const response = await fetch('/api/config')
    if (!response.ok) throw new Error(`配置接口返回 HTTP ${response.status}`)
    const remote = await response.json() as Partial<WebConfig>
    return {
      ...默认配置,
      ...remote,
      defaultModel: local?.defaultModel || remote.defaultModel || 默认配置.defaultModel,
      promptModel: local?.promptModel || remote.promptModel || 默认配置.promptModel
    }
  } catch {
    return {
      ...默认配置,
      defaultModel: local?.defaultModel || 默认配置.defaultModel,
      promptModel: local?.promptModel || 默认配置.promptModel
    }
  }
}

async function listConversations(): Promise<Conversation[]> {
  const conversations = await listConversationsFromDB()
  await hydrateReferenceUrls(conversations.flatMap((conversation) => conversation.referenceImages))
  return conversations
}

async function createConversation(input: ConversationCreateInput = {}): Promise<Conversation> {
  const settings = await getSettings()
  const now = new Date().toISOString()
  const ratio = input.ratio || '1:1'
  const conversation: Conversation = {
    id: generateUUID(),
    title: '新会话',
    draftPrompt: '',
    model: input.model || settings.defaultModel,
    ratio,
    size: input.size || getDefaultImageSize(ratio),
    quality: input.quality || 'high',
    n: normalizeInteger(input.n, 1, 10) || 1,
    outputFormat: input.outputFormat || DEFAULT_IMAGE_OUTPUT_FORMAT,
    outputCompression: input.outputCompression ?? null,
    background: input.background || 'auto',
    moderation: input.moderation || 'auto',
    stream: input.stream || false,
    partialImages: input.partialImages ?? 0,
    inputFidelity: input.inputFidelity ?? null,
    providerId: input.providerId ?? null,
    complexity: input.complexity ?? null,
    frameCount: input.frameCount ?? null,
    frameDurationMs: input.frameDurationMs ?? null,
    seed: input.seed ?? null,
    seedLocked: input.seedLocked ?? false,
    autoSaveHistory: input.autoSaveHistory ?? true,
    keepFailureDetails: input.keepFailureDetails ?? true,
    referenceImages: [],
    createdAt: now,
    updatedAt: now
  }
  return putRecord('conversations', conversation)
}

async function updateConversation(id: string, input: ConversationUpdate): Promise<Conversation> {
  const current = await getRecord<Conversation>('conversations', id)
  if (!current) throw new Error('会话不存在。')
  const next: Conversation = {
    ...current,
    ...input,
    size: input.size ?? (input.ratio ? getDefaultImageSize(input.ratio) : current.size),
    n: input.n !== undefined ? Math.min(10, Math.max(1, Math.trunc(input.n))) : current.n,
    updatedAt: new Date().toISOString()
  }
  await hydrateReferenceUrls(next.referenceImages)
  return putRecord('conversations', next)
}

async function deleteConversation(id: string): Promise<void> {
  const history = await listRecords<ImageHistoryItem>('imageHistory')
  await Promise.all(history.filter((item) => item.conversationId === id).map((item) => putRecord('imageHistory', { ...item, conversationId: null })))
  await deleteRecord('conversations', id)
}

async function listRuns(conversationId: string): Promise<GenerationRun[]> {
  const runs = await listRunsFromDB(conversationId)
  await hydrateImageUrls(runs.flatMap((run) => run.items))
  await hydrateReferenceUrls(runs.flatMap((run) => run.referenceImages))
  return runs
}

async function listHistory(options: HistoryListOptions = {}): Promise<ImageHistoryItem[]> {
  const references = await listRecords<ReferenceImage>('referenceImages')
  const referenceById = new Map(references.map((reference) => [reference.id, reference]))
  const query = options.query?.trim().toLowerCase() || ''
  const history = (await listRecords<ImageHistoryItem>('imageHistory'))
    .filter((item) => !options.favoritesOnly || item.favorite)
    .filter((item) => !query || [item.prompt, item.model, item.size || ''].some((value) => value.toLowerCase().includes(query)))
    .sort((a, b) => options.sort === 'oldest' ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt))
    .map((item) => ({
      ...item,
      referenceImages: item.referenceImages.map((reference) => referenceById.get(reference.id) || reference)
    }))
  await hydrateImageUrls(history)
  await hydrateReferenceUrls(history.flatMap((item) => item.referenceImages))
  return history
}

async function generateImage(input: GenerateImageInput): Promise<GenerateImageResult> {
  const startedAt = Date.now()
  const conversation = await getRecord<Conversation>('conversations', input.conversationId)
  if (!conversation) throw new Error('会话不存在。')
  const prompt = input.prompt.trim()
  const model = input.model.trim() || conversation.model
  const size = input.size.trim() || getDefaultImageSize(input.ratio)
  const targetCount = Math.min(10, Math.max(1, Math.trunc(input.n || 1)))
  const referenceImages = await getGenerationReferences(input)
  const generationMode: GenerationMode = referenceImages.length > 0 ? 'image-to-image' : 'text-to-image'
  const run: GenerationRun = {
    id: generateUUID(),
    conversationId: input.conversationId,
    prompt,
    model,
    ratio: input.ratio,
    size,
    quality: input.quality,
    n: targetCount,
    status: 'running',
    durationMs: null,
    errorMessage: null,
    errorDetails: null,
    generationMode,
    referenceImages,
    createdAt: new Date().toISOString(),
    items: []
  }
  await putRecord('generationRuns', run)

  if (!prompt) return saveFailure(input, run, model, 'Prompt is required.', startedAt, referenceImages)

  try {
    const items: ImageHistoryItem[] = []
    let succeededCount = 0
    await Promise.all(Array.from({ length: targetCount }, async (_value, requestIndex) => {
      try {
        const result = await requestImageGeneration({ ...input, n: 1 }, model, size, referenceImages)
        const image = result.data?.at(-1)
        const durationMs = Math.max(1000, Date.now() - startedAt)
        if (!image) {
          const item = await putRecord('imageHistory', createHistoryItem({
            id: generateUUID(),
            input,
            run,
            model,
            size,
            requestIndex,
            durationMs,
            status: 'failed',
            errorMessage: result.error?.message || '图片接口没有返回图片。',
            errorDetails: result.error?.message || '图片接口没有返回图片。',
            referenceImages
          }))
          items.push(item)
          return
        }

        const blob = await imageDataToBlob(image, input.outputFormat || DEFAULT_IMAGE_OUTPUT_FORMAT)
        const id = generateUUID()
        const item = await putRecord('imageHistory', createHistoryItem({
          id,
          input,
          run,
          model,
          size,
          requestIndex,
          durationMs,
          status: 'succeeded',
          fileSizeBytes: blob.size,
          referenceImages
        }))
        const imageBlob: WebImageBlobRecord = {
          id: generateUUID(),
          historyId: id,
          blob,
          mimeType: blob.type || mimeTypeFromOutputFormat(input.outputFormat || DEFAULT_IMAGE_OUTPUT_FORMAT),
          fileName: `${id}${extensionFromOutputFormat(input.outputFormat || DEFAULT_IMAGE_OUTPUT_FORMAT)}`,
          fileSizeBytes: blob.size,
          createdAt: new Date().toISOString()
        }
        await putRecord('imageBlobs', imageBlob)
        cacheImageUrl(id, blob)
        succeededCount += 1
        items.push(item)
      } catch (error) {
        const message = error instanceof Error ? error.message : '图片生成失败。'
        const item = await putRecord('imageHistory', createHistoryItem({
          id: generateUUID(),
          input,
          run,
          model,
          size,
          requestIndex,
          durationMs: Math.max(1000, Date.now() - startedAt),
          status: 'failed',
          errorMessage: message,
          errorDetails: message,
          referenceImages
        }))
        items.push(item)
      }
    }))

    const orderedItems = items.sort((left, right) => (left.requestIndex ?? 0) - (right.requestIndex ?? 0))
    const errorMessage = succeededCount === 0 ? '图片生成失败。' : null
    const completedRun: GenerationRun = {
      ...run,
      status: succeededCount > 0 ? 'succeeded' : 'failed',
      durationMs: Math.max(1000, Date.now() - startedAt),
      errorMessage,
      errorDetails: errorMessage,
      items: orderedItems
    }
    await putRecord('generationRuns', completedRun)
    return {
      run: completedRun,
      items: orderedItems,
      errorMessage: errorMessage || undefined,
      errorDetails: errorMessage || undefined
    }
  } catch (error) {
    return saveFailure(input, run, model, error instanceof Error ? error.message : '图片生成失败。', startedAt, referenceImages)
  }
}

async function requestImageGeneration(
  input: GenerateImageInput,
  model: string,
  size: string,
  referenceImages: ReferenceImage[]
): Promise<ImageProxyResponse> {
  const basePayload = {
    ...input,
    model,
    size,
    n: Math.min(10, Math.max(1, input.n || 1)),
    referenceImages: await Promise.all(referenceImages.map(async (reference) => {
      const record = await findReferenceBlobByReferenceId(reference.id)
      return record ? { name: reference.name, mimeType: reference.mimeType, data: await blobToBase64(record.blob) } : null
    }))
  }
  const response = await fetch(referenceImages.length > 0 ? '/api/images/edits' : '/api/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(basePayload)
  })
  const payload = await response.json().catch(() => ({})) as ImageProxyResponse
  if (!response.ok) throw new Error(payload.error?.message || `图片生成接口返回 HTTP ${response.status}`)
  return payload
}

async function saveFailure(
  input: GenerateImageInput,
  run: GenerationRun,
  model: string,
  message: string,
  startedAt: number,
  referenceImages: ReferenceImage[]
): Promise<GenerateImageResult> {
  const item = await putRecord('imageHistory', createHistoryItem({
    id: generateUUID(),
    input,
    run,
    model,
    size: input.size.trim() || getDefaultImageSize(input.ratio),
    requestIndex: null,
    durationMs: Math.max(1000, Date.now() - startedAt),
    status: 'failed',
    errorMessage: message,
    errorDetails: message,
    referenceImages
  }))
  const failedRun: GenerationRun = { ...run, status: 'failed', durationMs: item.durationMs, errorMessage: message, errorDetails: message, items: [item] }
  await putRecord('generationRuns', failedRun)
  return { run: failedRun, items: [item], errorMessage: message, errorDetails: message }
}

function createHistoryItem(input: {
  id: string
  input: GenerateImageInput
  run: GenerationRun
  model: string
  size: string
  requestIndex: number | null
  durationMs: number
  status: 'succeeded' | 'failed'
  fileSizeBytes?: number | null
  errorMessage?: string | null
  errorDetails?: string | null
  referenceImages: ReferenceImage[]
}): ImageHistoryItem {
  return {
    id: input.id,
    conversationId: input.input.conversationId,
    runId: input.run.id,
    prompt: input.input.prompt.trim(),
    model: input.model,
    ratio: input.input.ratio,
    size: input.size,
    quality: input.input.quality,
    requestIndex: input.requestIndex,
    durationMs: input.durationMs,
    filePath: null,
    fileSizeBytes: input.fileSizeBytes ?? null,
    status: input.status,
    errorMessage: input.errorMessage ?? null,
    errorDetails: input.errorDetails ?? null,
    favorite: false,
    generationMode: input.run.generationMode,
    referenceImages: input.referenceImages,
    createdAt: new Date().toISOString()
  }
}

async function importReferenceFiles(conversationId: string, files: ReferenceImageImportFile[]): Promise<ReferenceImage[]> {
  const conversation = await getRecord<Conversation>('conversations', conversationId)
  if (!conversation) throw new Error('会话不存在。')
  const imported: ReferenceImage[] = []
  for (const [index, file] of files.entries()) {
    const reference: ReferenceImage = {
      id: generateUUID(),
      name: file.name,
      mimeType: file.mimeType,
      filePath: null,
      fileSizeBytes: file.data.byteLength,
      createdAt: new Date().toISOString()
    }
    const blob = new Blob([file.data], { type: file.mimeType })
    const blobRecord: WebReferenceBlobRecord = { id: generateUUID(), referenceImageId: reference.id, blob }
    await putRecord('referenceImages', { ...reference, conversationId, sortOrder: conversation.referenceImages.length + index })
    await putRecord('referenceImageBlobs', blobRecord)
    cacheReferenceUrl(reference.id, blob)
    imported.push(reference)
  }
  const referenceImages = [...conversation.referenceImages, ...imported]
  await updateConversation(conversationId, { referenceImages } as ConversationUpdate)
  return referenceImages
}

async function addFromHistory(conversationId: string, historyId: string): Promise<ReferenceImage[]> {
  const imageBlob = await findImageBlobByHistoryId(historyId)
  const conversation = await getRecord<Conversation>('conversations', conversationId)
  if (!imageBlob || !conversation) throw new Error('无法从历史图片添加参考图。')
  const reference: ReferenceImage = {
    id: generateUUID(),
    name: imageBlob.fileName,
    mimeType: imageBlob.mimeType,
    filePath: null,
    fileSizeBytes: imageBlob.fileSizeBytes,
    createdAt: new Date().toISOString()
  }
  await putRecord('referenceImages', { ...reference, conversationId, sortOrder: conversation.referenceImages.length })
  await putRecord('referenceImageBlobs', { id: generateUUID(), referenceImageId: reference.id, blob: imageBlob.blob })
  cacheReferenceUrl(reference.id, imageBlob.blob)
  const referenceImages = [...conversation.referenceImages, reference]
  await updateConversation(conversationId, { referenceImages } as ConversationUpdate)
  return referenceImages
}

async function removeReferenceImage(conversationId: string, referenceImageId: string): Promise<ReferenceImage[]> {
  const conversation = await getRecord<Conversation>('conversations', conversationId)
  if (!conversation) throw new Error('会话不存在。')
  await deleteRecord('referenceImages', referenceImageId)
  const blobRecord = await findReferenceBlobByReferenceId(referenceImageId)
  if (blobRecord) await deleteRecord('referenceImageBlobs', blobRecord.id)
  const referenceImages = conversation.referenceImages.filter((reference) => reference.id !== referenceImageId)
  await updateConversation(conversationId, { referenceImages } as ConversationUpdate)
  return referenceImages
}

async function reorderReferenceImages(conversationId: string, referenceImageIds: string[]): Promise<ReferenceImage[]> {
  const conversation = await getRecord<Conversation>('conversations', conversationId)
  if (!conversation) throw new Error('会话不存在。')
  const referenceById = new Map(conversation.referenceImages.map((reference) => [reference.id, reference]))
  const referenceImages = referenceImageIds.map((id) => referenceById.get(id)).filter((item): item is ReferenceImage => Boolean(item))
  await updateConversation(conversationId, { referenceImages } as ConversationUpdate)
  return referenceImages
}

async function deleteHistory(id: string): Promise<void> {
  const imageBlob = await findImageBlobByHistoryId(id)
  if (imageBlob) await deleteRecord('imageBlobs', imageBlob.id)
  await deleteRecord('imageHistory', id)
}

async function setFavorite(id: string, favorite: boolean): Promise<ImageHistoryItem> {
  const item = await getRecord<ImageHistoryItem>('imageHistory', id)
  if (!item) throw new Error('历史记录不存在。')
  return putRecord('imageHistory', { ...item, favorite })
}

async function copyImage(id: string): Promise<void> {
  const imageBlob = await findImageBlobByHistoryId(id)
  if (!imageBlob) throw new Error('图片数据不存在。')
  await navigator.clipboard.write([new ClipboardItem({ [imageBlob.mimeType]: imageBlob.blob })])
}

async function downloadImage(id: string): Promise<string | null> {
  const imageBlob = await findImageBlobByHistoryId(id)
  if (!imageBlob) return null
  downloadBlob(imageBlob.blob, imageBlob.fileName)
  return imageBlob.fileName
}

async function downloadManyImages(ids: string[]): Promise<BatchDownloadResult | null> {
  let saved = 0
  for (const id of ids) {
    const result = await downloadImage(id)
    if (result) saved += 1
  }
  return { directory: '浏览器下载目录', saved, skipped: ids.length - saved }
}

async function requestPrompt(path: string, input: PromptAssistInput): Promise<string> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  })
  const payload = await response.json().catch(() => ({})) as { text?: string; error?: { message?: string } }
  if (!response.ok) throw new Error(payload.error?.message || '提示词助手请求失败。')
  if (!payload.text) throw new Error('提示词助手没有返回内容。')
  return payload.text
}

async function getGenerationReferences(input: GenerateImageInput): Promise<ReferenceImage[]> {
  if (!input.referenceImageIds?.length) return []
  const conversation = await getRecord<Conversation>('conversations', input.conversationId)
  const requested = new Set(input.referenceImageIds)
  return (conversation?.referenceImages || []).filter((reference) => requested.has(reference.id)).slice(0, 8)
}

async function hydrateImageUrls(items: ImageHistoryItem[]): Promise<void> {
  await Promise.all(items.filter((item) => item.status === 'succeeded').map(async (item) => {
    if (图片地址缓存.has(item.id)) return
    const record = await findImageBlobByHistoryId(item.id)
    if (record) cacheImageUrl(item.id, record.blob)
  }))
}

async function hydrateReferenceUrls(references: ReferenceImage[]): Promise<void> {
  await Promise.all(references.map(async (reference) => {
    if (参考图地址缓存.has(reference.id)) return
    const record = await findReferenceBlobByReferenceId(reference.id)
    if (record) cacheReferenceUrl(reference.id, record.blob)
  }))
}

function cacheImageUrl(id: string, blob: Blob): void {
  const current = 图片地址缓存.get(id)
  if (current) URL.revokeObjectURL(current)
  图片地址缓存.set(id, URL.createObjectURL(blob))
}

function cacheReferenceUrl(id: string, blob: Blob): void {
  const current = 参考图地址缓存.get(id)
  if (current) URL.revokeObjectURL(current)
  参考图地址缓存.set(id, URL.createObjectURL(blob))
}

async function imageDataToBlob(image: { b64_json?: string; url?: string }, outputFormat: ImageOutputFormat): Promise<Blob> {
  if (image.b64_json) {
    const bytes = Uint8Array.from(atob(image.b64_json), (char) => char.charCodeAt(0))
    return new Blob([bytes], { type: mimeTypeFromOutputFormat(outputFormat) })
  }
  if (image.url) {
    const response = await fetch(image.url)
    if (!response.ok) throw new Error(`无法下载生成图片：HTTP ${response.status}`)
    return response.blob()
  }
  throw new Error('图片接口响应中没有图片数据。')
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error || new Error('读取文件失败。'))
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.readAsDataURL(blob)
  })
}

function normalizeInteger(value: number | undefined, min: number, max: number): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function mimeTypeFromOutputFormat(format: ImageOutputFormat): string {
  if (format === 'jpeg') return 'image/jpeg'
  if (format === 'webp') return 'image/webp'
  return 'image/png'
}

function extensionFromOutputFormat(format: ImageOutputFormat): string {
  if (format === 'jpeg') return '.jpg'
  if (format === 'webp') return '.webp'
  return '.png'
}
