import { create } from 'zustand'
import { formatDuration } from '@shared/duration'
import { DEFAULT_IMAGE_OUTPUT_FORMAT, DEFAULT_MODEL, getDefaultImageSize, getOutputFormatsFor, resolveModelCapabilities } from '@shared/image-options'
import { resolveActiveProvider } from '@shared/provider-selection'
import type {
  Provider,
  ProviderInput,
  Conversation,
  ConversationCreateInput,
  ConversationUpdate,
  GenerateImageInput,
  GenerationRun,
  HistoryListOptions,
  ImageHistoryItem,
  ImageOutputFormat,
  ProviderSettings,
  ProviderSettingsUpdate
} from '@shared/types'
import {
  beginConversationGeneration,
  endConversationGeneration,
  getConversationGenerationState as getConversationGenerationStateForId,
  markGenerationRequestRemoved,
  pruneRemovedGenerationIndexesByRunId
} from './generation-state'
import type { PromptTemplate } from '../prompt-library'

type View = 'workspace' | 'gallery' | 'prompts'

const PROMPT_ASSISTANT_STORAGE_KEY = 'pictverse-assistant-config'

/** 读取提示词助手本地配置；字段缺失时走主进程的全局回填 */
function readPromptAssistantConfig(): Record<string, unknown> | undefined {
  try {
    const raw = window.localStorage.getItem(PROMPT_ASSISTANT_STORAGE_KEY)
    if (!raw) return undefined
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

function normalizeConversationInteger(value: number | null | undefined, min: number, max: number): number | undefined {
  if (value === null || value === undefined) return undefined
  if (!Number.isFinite(value)) return undefined
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function normalizeConversationOptionalInteger(
  value: number | null | undefined,
  min: number,
  max: number
): number | null | undefined {
  if (value === null || value === undefined) return value
  if (!Number.isFinite(value)) return null
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

/**
 * 当目标模型/供应商不支持当前输出格式时，返回应回落到的格式；否则返回 undefined（不改动）。
 * 供所有会改动 model 或 providerId 的入口复用，避免各路径判断不一致。
 * 供应商解析统一走 resolveActiveProvider，与 UI 侧保持同一口径。
 */
function resolveAllowedOutputFormat(
  model: string,
  providerId: string | null,
  currentFormat: ImageOutputFormat | null | undefined,
  providers: Provider[]
): ImageOutputFormat | undefined {
  if (!currentFormat) return undefined
  const provider = resolveActiveProvider(providerId, providers)
  const allowed = getOutputFormatsFor(model, provider)
  return allowed.includes(currentFormat) ? undefined : DEFAULT_IMAGE_OUTPUT_FORMAT
}

export type PendingMask = {
  dataUrl: string
  previewUrl: string
  referenceId: string
}

type AppState = {
  view: View
  settingsVisible: boolean
  drawer: 'none' | 'sessions' | 'params'
  settingsModalOpen: boolean
  pendingMask: PendingMask | null
  darkMode: boolean
  settings: ProviderSettings | null
  conversations: Conversation[]
  activeConversationId: string | null
  runsByConversation: Record<string, GenerationRun[]>
  history: ImageHistoryItem[]
  query: string
  sort: 'newest' | 'oldest'
  favoritesOnly: boolean
  loading: boolean
  generationClockMs: number
  generatingByConversation: Record<string, number>
  generationStartedAtByConversation: Record<string, number>
  removedGenerationIndexesByRunId: Record<string, number[]>
  promptAssistantRunning: { inspire: boolean; enrich: boolean }
  toast: string | null
  providers: Provider[]
  activeProviderId: string | null
  getConversationGenerationState: (conversationId: string) => { generating: boolean; startedAt: number | null; activeCount: number }
  load: () => Promise<void>
  setView: (view: View) => void
  toggleSettings: () => void
  toggleTheme: () => void
  setDrawer: (drawer: 'none' | 'sessions' | 'params') => void
  setSettingsModalOpen: (open: boolean) => void
  setPendingMask: (mask: PendingMask | null) => void
  toggleSessionsDrawer: () => void
  toggleParamsDrawer: () => void
  setQuery: (query: string) => void
  setSort: (sort: 'newest' | 'oldest') => Promise<void>
  setFavoritesOnly: (favoritesOnly: boolean) => Promise<void>
  setActiveConversation: (id: string) => Promise<void>
  createConversation: (template?: ConversationCreateInput, options?: { silent?: boolean }) => Promise<void>
  deleteConversation: (id: string) => Promise<void>
  updateActiveConversation: (input: ConversationUpdate) => Promise<void>
  updateSettings: (input: ProviderSettingsUpdate) => Promise<void>
  importReferenceFiles: (files: File[]) => Promise<void>
  addHistoryAsReference: (historyId: string) => Promise<void>
  removeReferenceImage: (referenceImageId: string) => Promise<void>
  reorderReferenceImages: (referenceImageIds: string[]) => Promise<void>
  applyPromptTemplate: (template: PromptTemplate) => Promise<void>
  inspirePrompt: () => Promise<void>
  enrichPrompt: () => Promise<void>
  generate: () => Promise<void>
  refreshConversationResults: (conversationId: string) => Promise<void>
  cancelGeneration: (runId?: string, requestIndex?: number) => Promise<void>
  reloadHistory: (options?: Partial<HistoryListOptions>) => Promise<void>
  deleteHistory: (id: string) => Promise<void>
  deleteHistoryItems: (ids: string[]) => Promise<void>
  toggleFavorite: (item: ImageHistoryItem) => Promise<void>
  setFavoriteForHistoryItems: (items: ImageHistoryItem[], favorite: boolean) => Promise<void>
  retryHistory: (item: ImageHistoryItem) => Promise<void>
  reuseHistory: (item: ImageHistoryItem) => Promise<void>
  notify: (message: string | null) => void
  loadProviders: () => Promise<void>
  saveProvider: (input: ProviderInput, id?: string) => Promise<void>
  deleteProvider: (id: string) => Promise<void>
  makeProviderDefault: (id: string) => Promise<void>
  fetchProviderModels: (id: string) => Promise<string[]>
  saveProviderModels: (id: string, modelIds: string[]) => Promise<void>
}

let generationClockTimer: number | null = null

function startGenerationClock(): void {
  if (generationClockTimer != null || typeof window === 'undefined') return
  generationClockTimer = window.setInterval(() => {
    useAppStore.setState({ generationClockMs: Date.now() })
  }, 1000)
}

function stopGenerationClock(): void {
  if (generationClockTimer == null) return
  window.clearInterval(generationClockTimer)
  generationClockTimer = null
}

function collectRunningRunIds(runsByConversation: Record<string, GenerationRun[]>): string[] {
  return Object.values(runsByConversation)
    .flatMap((runs) => runs.filter((run) => run.status === 'running').map((run) => run.id))
}

export const useAppStore = create<AppState>((set, get) => ({
  view: 'workspace',
  settingsVisible: true,
  drawer: 'none',
  settingsModalOpen: false,
  pendingMask: null,
  darkMode: false,
  settings: null,
  conversations: [],
  activeConversationId: null,
  runsByConversation: {},
  history: [],
  query: '',
  sort: 'newest',
  favoritesOnly: false,
  loading: false,
  generationClockMs: Date.now(),
  generatingByConversation: {},
  generationStartedAtByConversation: {},
  removedGenerationIndexesByRunId: {},
  promptAssistantRunning: { inspire: false, enrich: false },
  toast: null,
  providers: [],
  activeProviderId: null,
  getConversationGenerationState: (conversationId) =>
    getConversationGenerationStateForId(conversationId, get().generatingByConversation, get().generationStartedAtByConversation),
  load: async () => {
    set({ loading: true })
    try {
      const settings = await window.pictverse.settings.get()
      let conversations = await window.pictverse.conversation.list()
      if (conversations.length === 0) conversations = [await window.pictverse.conversation.create()]
      const activeConversationId = get().activeConversationId || conversations[0]?.id || null
      const runs = activeConversationId ? await window.pictverse.conversation.runs(activeConversationId) : []
      const history = await window.pictverse.history.list({ sort: get().sort })
      const providers = await window.pictverse.provider.list()
      const providerList = providers.length
        ? providers
        : [await window.pictverse.provider.create({
            name: 'OpenAI 官方',
            baseURL: settings.baseURL || 'https://api.openai.com',
            defaultModel: settings.defaultModel || DEFAULT_MODEL,
            promptModel: settings.promptModel || null,
            isDefault: true
          })]
      await get().loadProviders()
      const activeProviderIdValue = providerList.find((item) => item.isDefault)?.id || providerList[0]?.id || null
      set({
        settings,
        conversations,
        activeConversationId,
        runsByConversation: activeConversationId ? { [activeConversationId]: runs } : {},
        history,
        activeProviderId: get().activeProviderId || activeProviderIdValue,
        loading: false
      })
    } catch (error) {
      console.error('[PictVerse] 初始化失败：', error)
      set({ loading: false })
      get().notify(error instanceof Error ? `初始化失败：${error.message}` : '初始化失败，请刷新页面重试。')
    }
  },
  setView: (view) => set({ view }),
  toggleSettings: () => set((state) => ({ settingsVisible: !state.settingsVisible, view: 'workspace' })),
  toggleTheme: () => set((state) => ({ darkMode: !state.darkMode })),
  setDrawer: (drawer) => set({ drawer }),
  setSettingsModalOpen: (open) => set({ settingsModalOpen: open }),
  setPendingMask: (mask) => set({ pendingMask: mask }),
  toggleSessionsDrawer: () => set((state) => ({ drawer: state.drawer === 'sessions' ? 'none' : 'sessions' })),
  toggleParamsDrawer: () => set((state) => ({ drawer: state.drawer === 'params' ? 'none' : 'params' })),
  setQuery: (query) => set({ query }),
  setSort: async (sort) => {
    set({ sort })
    await get().reloadHistory({ sort })
  },
  setFavoritesOnly: async (favoritesOnly) => {
    set({ favoritesOnly })
    await get().reloadHistory({ favoritesOnly })
  },
  setActiveConversation: async (id) => {
    set({ activeConversationId: id, view: 'workspace' })
    if (!get().runsByConversation[id]) {
      const runs = await window.pictverse.conversation.runs(id)
      set({ runsByConversation: { ...get().runsByConversation, [id]: runs } })
    }
  },
  createConversation: async (template = {}, options = {}) => {
    try {
      const current = get().conversations.find((item) => item.id === get().activeConversationId) || get().conversations[0] || null
      const conversation = await window.pictverse.conversation.create({
        ratio: template.ratio ?? current?.ratio,
        size: template.size ?? current?.size,
        quality: template.quality ?? current?.quality,
        model: template.model ?? current?.model,
        n: template.n ?? current?.n,
        outputFormat: template.outputFormat ?? current?.outputFormat,
        outputCompression: template.outputCompression ?? current?.outputCompression,
        background: template.background ?? current?.background,
        moderation: template.moderation ?? current?.moderation,
        stream: template.stream ?? current?.stream,
        partialImages: template.partialImages ?? current?.partialImages,
        inputFidelity: template.inputFidelity ?? current?.inputFidelity,
        autoSaveHistory: template.autoSaveHistory ?? current?.autoSaveHistory,
        keepFailureDetails: template.keepFailureDetails ?? current?.keepFailureDetails
      })
      set({
        conversations: [conversation, ...get().conversations],
        activeConversationId: conversation.id,
        view: 'workspace',
        runsByConversation: { ...get().runsByConversation, [conversation.id]: [] }
      })
      if (!options.silent) get().notify('已新建会话')
    } catch (error) {
      console.error('[PictVerse] 新建会话失败：', error)
      get().notify(error instanceof Error ? `新建会话失败：${error.message}` : '新建会话失败。')
    }
  },
  deleteConversation: async (id) => {
    const deletedConversation = get().conversations.find((item) => item.id === id) || null
    await window.pictverse.conversation.delete(id)
    let conversations = get().conversations.filter((item) => item.id !== id)
    if (conversations.length === 0) {
      const runsByConversation = { ...get().runsByConversation }
      delete runsByConversation[id]
      set({ conversations: [], activeConversationId: null, runsByConversation })
      await get().createConversation({
        ratio: deletedConversation?.ratio,
        size: deletedConversation?.size,
        quality: deletedConversation?.quality,
        model: deletedConversation?.model,
        n: deletedConversation?.n,
        outputFormat: deletedConversation?.outputFormat,
        outputCompression: deletedConversation?.outputCompression,
        background: deletedConversation?.background,
        moderation: deletedConversation?.moderation,
        stream: deletedConversation?.stream,
        partialImages: deletedConversation?.partialImages,
        inputFidelity: deletedConversation?.inputFidelity,
        autoSaveHistory: deletedConversation?.autoSaveHistory,
        keepFailureDetails: deletedConversation?.keepFailureDetails
      }, { silent: true })
      get().notify('已删除会话，历史记录已保留')
      return
    }
    const activeConversationId = get().activeConversationId === id ? conversations[0].id : get().activeConversationId
    const runsByConversation = { ...get().runsByConversation }
    delete runsByConversation[id]
    set({ conversations, activeConversationId, runsByConversation })
    get().notify('已删除会话，历史记录已保留')
  },
  updateActiveConversation: async (input) => {
    const id = get().activeConversationId
    if (!id) return
    const normalizedBase: ConversationUpdate = { ...input }
    if (input.n !== undefined) {
      normalizedBase.n = normalizeConversationInteger(input.n, 1, 10) ?? 1
    }
    if (input.outputCompression !== undefined) {
      normalizedBase.outputCompression = normalizeConversationOptionalInteger(input.outputCompression, 0, 100) ?? null
    }
    if (input.partialImages !== undefined) {
      normalizedBase.partialImages = normalizeConversationOptionalInteger(input.partialImages, 0, 3) ?? null
    }
    const normalized =
      normalizedBase.ratio !== undefined && normalizedBase.size === undefined
        ? { ...normalizedBase, size: getDefaultImageSize(normalizedBase.ratio) }
        : normalizedBase

    // 任何一次会话更新都会校验格式与遮罩能力（不只是改 model/providerId 时），
    // 这样供应商配置在设置页被改掉后，用户随手碰一次参数即可自愈，脏数据也能被纠正。
    const currentConversation = get().conversations.find((item) => item.id === id)
    if (currentConversation) {
      const nextModel = normalized.model ?? currentConversation.model
      const providers = get().providers
      const notices: string[] = []

      const nextFormat = resolveAllowedOutputFormat(
        nextModel,
        normalized.providerId ?? currentConversation.providerId,
        normalized.outputFormat ?? currentConversation.outputFormat,
        providers
      )
      if (nextFormat !== undefined) {
        // 静默改值会让用户以为「点了没反应」，明确告知回落原因
        const previousFormat = normalized.outputFormat ?? currentConversation.outputFormat
        normalized.outputFormat = nextFormat
        if (previousFormat && previousFormat !== nextFormat) {
          notices.push(`已从 ${previousFormat.toUpperCase()} 改用 ${nextFormat.toUpperCase()}（当前模型不支持）`)
        }
      }

      // 遮罩同理：能力被关闭时，已涂抹的遮罩不能继续随请求发出（会在上游 400）
      if (get().pendingMask) {
        const maskStillSupported = resolveModelCapabilities(
          nextModel,
          resolveActiveProvider(normalized.providerId ?? currentConversation.providerId, providers)
        ).mask
        if (!maskStillSupported) {
          set({ pendingMask: null })
          notices.push('已清除已应用的遮罩（当前模型不支持遮罩）')
        }
      }

      // toast 是单值字段，多条提示必须合并，否则后者会覆盖前者
      if (notices.length > 0) get().notify(notices.join('；'))
    }

    const draftPromptOnly = Object.keys(normalized).length === 1 && Object.prototype.hasOwnProperty.call(normalized, 'draftPrompt')
    set({
      conversations: get().conversations.map((item) =>
        item.id === id ? { ...item, ...normalized, updatedAt: new Date().toISOString() } : item
      )
    })
    if (draftPromptOnly) {
      void window.pictverse.conversation.update(id, normalized).catch((error) => {
        get().notify(error instanceof Error ? error.message : '草稿保存失败')
      })
      return
    }
    const updated = await window.pictverse.conversation.update(id, normalized)
    set({ conversations: get().conversations.map((item) => (item.id === id ? updated : item)) })
  },
  updateSettings: async (input) => {
    const settings = await window.pictverse.settings.update(input)
    set({ settings })
    get().notify('设置已保存')
  },
  importReferenceFiles: async (files) => {
    const id = get().activeConversationId
    if (!id || files.length === 0) return
    try {
      const payload = await Promise.all(files.map(async (file) => ({
        name: file.name,
        mimeType: file.type,
        data: await file.arrayBuffer()
      })))
      const referenceImages = await window.pictverse.reference.importFiles(id, payload)
      set({
        conversations: get().conversations.map((item) => (item.id === id ? { ...item, referenceImages } : item))
      })
      get().notify(`已添加 ${payload.length} 张参考图`)
    } catch (error) {
      get().notify(error instanceof Error ? error.message : '参考图添加失败')
    }
  },
  addHistoryAsReference: async (historyId) => {
    const state = get()
    const id = state.activeConversationId
    if (!id) return
    const conversation = state.conversations.find((item) => item.id === id)
    const sourceItem = state.history.find((item) => item.id === historyId)
      || Object.values(state.runsByConversation)
        .flatMap((runs) => runs.flatMap((run) => run.items))
        .find((item) => item.id === historyId)
    try {
      for (const reference of conversation?.referenceImages || []) {
        await window.pictverse.reference.remove(id, reference.id)
      }
      const referenceImages = await window.pictverse.reference.addFromHistory(id, historyId)
      const updated = await window.pictverse.conversation.update(id, {
        draftPrompt: sourceItem?.prompt || '',
        ratio: sourceItem?.ratio,
        size: sourceItem?.size || (sourceItem?.ratio ? getDefaultImageSize(sourceItem.ratio) : undefined),
        model: sourceItem?.model,
        quality: sourceItem?.quality
      })
      set({
        conversations: get().conversations.map((item) => (item.id === id ? { ...updated, referenceImages } : item)),
        view: 'workspace'
      })
      get().notify('已进入编辑')
    } catch (error) {
      get().notify(error instanceof Error ? error.message : '编辑失败')
    }
  },
  removeReferenceImage: async (referenceImageId) => {
    const id = get().activeConversationId
    if (!id) return
    const referenceImages = await window.pictverse.reference.remove(id, referenceImageId)
    set({
      conversations: get().conversations.map((item) => (item.id === id ? { ...item, referenceImages } : item))
    })
  },
  reorderReferenceImages: async (referenceImageIds) => {
    const id = get().activeConversationId
    if (!id) return
    const referenceImages = await window.pictverse.reference.reorder(id, referenceImageIds)
    set({
      conversations: get().conversations.map((item) => (item.id === id ? { ...item, referenceImages } : item))
    })
  },
  applyPromptTemplate: async (template) => {
    const state = get()
    let conversation = state.conversations.find((item) => item.id === state.activeConversationId) || null
    const templateModel = template.model?.trim() || ''
    if (!conversation) {
      await get().createConversation(
        {
          ratio: template.ratio,
          size: template.resolution || getDefaultImageSize(template.ratio),
          quality: template.quality,
          model: templateModel || undefined
        },
        { silent: true }
      )
      conversation = get().conversations.find((item) => item.id === get().activeConversationId) || null
    }
    if (!conversation) return

    const patch: ConversationUpdate = {
      draftPrompt: template.prompt,
      ratio: template.ratio,
      size: template.resolution || getDefaultImageSize(template.ratio),
      quality: template.quality
    }
    if (templateModel) {
      patch.model = templateModel
    }
    if (conversation.title === '新会话') {
      patch.title = template.title
    }

    await get().updateActiveConversation(patch)
    set({ view: 'workspace' })
    get().notify(`已套用「${template.title}」`)
  },
  inspirePrompt: async () => {
    const conversation = get().conversations.find((item) => item.id === get().activeConversationId)
    if (!conversation || get().promptAssistantRunning.inspire) return
    set({ promptAssistantRunning: { ...get().promptAssistantRunning, inspire: true } })
    try {
      const prompt = await window.pictverse.prompt.inspire({
        hasReferenceImages: conversation.referenceImages.length > 0,
        config: readPromptAssistantConfig()
      })
      const updated = await window.pictverse.conversation.update(conversation.id, { draftPrompt: prompt })
      set({
        conversations: get().conversations.map((item) => (item.id === conversation.id ? updated : item))
      })
      get().notify('已生成灵感提示词')
    } catch (error) {
      get().notify(error instanceof Error ? `提示词生成失败：${error.message}` : '提示词生成失败')
    } finally {
      set({ promptAssistantRunning: { ...get().promptAssistantRunning, inspire: false } })
    }
  },
  enrichPrompt: async () => {
    const conversation = get().conversations.find((item) => item.id === get().activeConversationId)
    const currentPrompt = conversation?.draftPrompt.trim() || ''
    if (!conversation || !currentPrompt || get().promptAssistantRunning.enrich) return
    set({ promptAssistantRunning: { ...get().promptAssistantRunning, enrich: true } })
    try {
      const prompt = await window.pictverse.prompt.enrich({
        prompt: currentPrompt,
        hasReferenceImages: conversation.referenceImages.length > 0,
        config: readPromptAssistantConfig()
      })
      const updated = await window.pictverse.conversation.update(conversation.id, { draftPrompt: prompt })
      set({
        conversations: get().conversations.map((item) => (item.id === conversation.id ? updated : item))
      })
      get().notify('已丰富提示词')
    } catch (error) {
      get().notify(error instanceof Error ? `提示词生成失败：${error.message}` : '提示词生成失败')
    } finally {
      set({ promptAssistantRunning: { ...get().promptAssistantRunning, enrich: false } })
    }
  },
  generate: async () => {
    const state = get()
    const conversation = state.conversations.find((item) => item.id === state.activeConversationId)
    if (!conversation) return
    const generationStartedAt = Date.now()
    set({ generationClockMs: generationStartedAt })
    startGenerationClock()
    const prompt = conversation.draftPrompt.trim()
    // 与下方 input.model 的取值口径保持一致，避免空模型时两处判定不同
    const effectiveModel = conversation.model || state.settings?.defaultModel || DEFAULT_MODEL
    const maskSupported = resolveModelCapabilities(
      effectiveModel,
      resolveActiveProvider(conversation.providerId, state.providers)
    ).mask
    // 丢弃遮罩时必须清状态，否则界面仍显示「遮罩已应用」而请求里没有遮罩
    if (!maskSupported && state.pendingMask) {
      set({ pendingMask: null })
      get().notify('已清除已应用的遮罩（当前模型不支持遮罩）')
    }
    const input: GenerateImageInput = {
      conversationId: conversation.id,
      prompt,
      model: effectiveModel,
      ratio: conversation.ratio,
      size: conversation.size || getDefaultImageSize(conversation.ratio),
      quality: conversation.quality,
      n: conversation.n,
      outputCompression: conversation.outputCompression ?? undefined,
      background: conversation.background,
      moderation: conversation.moderation,
      stream: conversation.stream,
      partialImages: conversation.partialImages ?? undefined,
      inputFidelity: conversation.inputFidelity ?? undefined,
      outputFormat: conversation.outputFormat || DEFAULT_IMAGE_OUTPUT_FORMAT,
      complexity: conversation.complexity ?? undefined,
      frameCount: conversation.frameCount ?? undefined,
      frameDurationMs: conversation.frameDurationMs ?? undefined,
      seed: conversation.seedLocked ? conversation.seed ?? undefined : undefined,
      providerId: conversation.providerId ?? undefined,
      // 遮罩能力复核（上方已在不支持时清空 pendingMask，这里取的是清空后的值）
      maskPngBase64: state.pendingMask?.dataUrl ?? undefined,
      referenceImageIds: conversation.referenceImages.map((reference) => reference.id)
    }
    const nextGenerationState = beginConversationGeneration(conversation.id, {
      generatingByConversation: state.generatingByConversation,
      startedAtByConversation: state.generationStartedAtByConversation,
      removedIndexesByRunId: state.removedGenerationIndexesByRunId
    }, generationStartedAt)
    set({
      generatingByConversation: nextGenerationState.generatingByConversation,
      generationStartedAtByConversation: nextGenerationState.startedAtByConversation,
      removedGenerationIndexesByRunId: nextGenerationState.removedIndexesByRunId
    })
    const titlePatch = conversation.title === '新会话' && prompt ? { title: prompt.length > 18 ? `${prompt.slice(0, 18)}...` : prompt } : null
    try {
      if (titlePatch) await get().updateActiveConversation(titlePatch)
      const resultPromise = window.pictverse.image.generate(input)
      void get().refreshConversationResults(conversation.id)
      const result = await resultPromise
      const runs = await window.pictverse.conversation.runs(conversation.id)
      const history = await window.pictverse.history.list({ query: state.query, sort: state.sort, favoritesOnly: state.favoritesOnly })
      const runsByConversation = { ...get().runsByConversation, [conversation.id]: runs }
      const runningRunIds = collectRunningRunIds(runsByConversation)
      const prunedGenerationState = pruneRemovedGenerationIndexesByRunId(runningRunIds, {
        generatingByConversation: get().generatingByConversation,
        startedAtByConversation: get().generationStartedAtByConversation,
        removedIndexesByRunId: get().removedGenerationIndexesByRunId
      })
      set({
        runsByConversation,
        history,
        removedGenerationIndexesByRunId: prunedGenerationState.removedIndexesByRunId
      })
      const durationText = result.run.durationMs != null ? `，用时 ${formatDuration(result.run.durationMs)}` : ''
      get().notify(result.canceled ? `已取消${durationText}` : result.errorMessage ? `生成失败：${result.errorMessage}${durationText}` : `生成完成${durationText}`)
    } catch (error) {
      get().notify(error instanceof Error ? `生成失败：${error.message}` : '生成失败')
    } finally {
      const nextGenerationState = endConversationGeneration(conversation.id, {
        generatingByConversation: get().generatingByConversation,
        startedAtByConversation: get().generationStartedAtByConversation,
        removedIndexesByRunId: get().removedGenerationIndexesByRunId
      })
      set({
        generatingByConversation: nextGenerationState.generatingByConversation,
        generationStartedAtByConversation: nextGenerationState.startedAtByConversation,
        removedGenerationIndexesByRunId: nextGenerationState.removedIndexesByRunId
      })
      if (Object.keys(nextGenerationState.generatingByConversation).length === 0) {
        stopGenerationClock()
      }
    }
  },
  refreshConversationResults: async (conversationId) => {
    const state = get()
    const runs = await window.pictverse.conversation.runs(conversationId)
    const history = await window.pictverse.history.list({
      query: state.query,
      sort: state.sort,
      favoritesOnly: state.favoritesOnly
    })
    const runsByConversation = { ...get().runsByConversation, [conversationId]: runs }
    const runningRunIds = collectRunningRunIds(runsByConversation)
    const nextGenerationState = pruneRemovedGenerationIndexesByRunId(runningRunIds, {
      generatingByConversation: get().generatingByConversation,
      startedAtByConversation: get().generationStartedAtByConversation,
      removedIndexesByRunId: get().removedGenerationIndexesByRunId
    })
    set({
      runsByConversation,
      history,
      removedGenerationIndexesByRunId: nextGenerationState.removedIndexesByRunId
    })
  },
  cancelGeneration: async (runId, requestIndex) => {
    if (!runId) return
    if (typeof requestIndex === 'number') {
      const nextGenerationState = markGenerationRequestRemoved(runId, requestIndex, {
        generatingByConversation: get().generatingByConversation,
        startedAtByConversation: get().generationStartedAtByConversation,
        removedIndexesByRunId: get().removedGenerationIndexesByRunId
      })
      set({
        generatingByConversation: nextGenerationState.generatingByConversation,
        generationStartedAtByConversation: nextGenerationState.startedAtByConversation,
        removedGenerationIndexesByRunId: nextGenerationState.removedIndexesByRunId
      })
    }
    await window.pictverse.image.cancel(runId, requestIndex)
  },
  reloadHistory: async (options = {}) => {
    const state = get()
    const history = await window.pictverse.history.list({
      query: options.query ?? state.query,
      sort: options.sort ?? state.sort,
      favoritesOnly: options.favoritesOnly ?? state.favoritesOnly
    })
    set({ history })
  },
  deleteHistory: async (id) => {
    const item = get().history.find((entry) => entry.id === id)
    await window.pictverse.history.delete(id)
    if (item?.conversationId && item.runId && typeof item.requestIndex === 'number') {
      const activeRun = get().runsByConversation[item.conversationId]?.find((run) => run.id === item.runId && run.status === 'running')
      if (activeRun) {
        const nextGenerationState = markGenerationRequestRemoved(item.runId, item.requestIndex, {
          generatingByConversation: get().generatingByConversation,
          startedAtByConversation: get().generationStartedAtByConversation,
          removedIndexesByRunId: get().removedGenerationIndexesByRunId
        })
        set({
          generatingByConversation: nextGenerationState.generatingByConversation,
          generationStartedAtByConversation: nextGenerationState.startedAtByConversation,
          removedGenerationIndexesByRunId: nextGenerationState.removedIndexesByRunId
        })
      }
    }
    await get().reloadHistory()
    if (item?.conversationId) {
      const runs = await window.pictverse.conversation.runs(item.conversationId)
      set({ runsByConversation: { ...get().runsByConversation, [item.conversationId]: runs } })
    }
    get().notify('已删除历史项')
  },
  deleteHistoryItems: async (ids) => {
    const selectedIds = new Set(ids)
    if (selectedIds.size === 0) return
    const state = get()
    const affectedConversationIds = new Set(
      state.history
        .filter((entry) => selectedIds.has(entry.id) && entry.conversationId)
        .map((entry) => entry.conversationId as string)
    )
    let nextRemovedIndexesByRunId = { ...state.removedGenerationIndexesByRunId }
    let nextGeneratingByConversation = { ...state.generatingByConversation }
    let nextStartedAtByConversation = { ...state.generationStartedAtByConversation }
    let removedStateChanged = false
    for (const id of selectedIds) {
      const item = state.history.find((entry) => entry.id === id)
      if (item?.conversationId && item.runId && typeof item.requestIndex === 'number') {
        const activeRun = state.runsByConversation[item.conversationId]?.find((run) => run.id === item.runId && run.status === 'running')
        if (activeRun) {
          const nextGenerationState = markGenerationRequestRemoved(item.runId, item.requestIndex, {
            generatingByConversation: nextGeneratingByConversation,
            startedAtByConversation: nextStartedAtByConversation,
            removedIndexesByRunId: nextRemovedIndexesByRunId
          })
          nextGeneratingByConversation = nextGenerationState.generatingByConversation
          nextStartedAtByConversation = nextGenerationState.startedAtByConversation
          nextRemovedIndexesByRunId = nextGenerationState.removedIndexesByRunId
          removedStateChanged = true
        }
      }
      await window.pictverse.history.delete(id)
    }
    if (removedStateChanged) {
      set({
        generatingByConversation: nextGeneratingByConversation,
        generationStartedAtByConversation: nextStartedAtByConversation,
        removedGenerationIndexesByRunId: nextRemovedIndexesByRunId
      })
    }
    await get().reloadHistory()
    const runsByConversation = { ...get().runsByConversation }
    for (const conversationId of affectedConversationIds) {
      runsByConversation[conversationId] = await window.pictverse.conversation.runs(conversationId)
    }
    set({ runsByConversation })
    get().notify(`已删除 ${selectedIds.size} 项`)
  },
  toggleFavorite: async (item) => {
    await window.pictverse.history.favorite(item.id, !item.favorite)
    await get().reloadHistory()
    if (item.conversationId) {
      const runs = await window.pictverse.conversation.runs(item.conversationId)
      set({ runsByConversation: { ...get().runsByConversation, [item.conversationId]: runs } })
    }
  },
  setFavoriteForHistoryItems: async (items, favorite) => {
    if (items.length === 0) return
    const affectedConversationIds = new Set(items.map((item) => item.conversationId).filter((id): id is string => Boolean(id)))
    for (const item of items) {
      await window.pictverse.history.favorite(item.id, favorite)
    }
    await get().reloadHistory()
    const runsByConversation = { ...get().runsByConversation }
    for (const conversationId of affectedConversationIds) {
      runsByConversation[conversationId] = await window.pictverse.conversation.runs(conversationId)
    }
    set({ runsByConversation })
    get().notify(favorite ? `已收藏 ${items.length} 项` : `已取消收藏 ${items.length} 项`)
  },
  retryHistory: async (item) => {
    let conversationId = item.conversationId || get().activeConversationId
    if (!conversationId) {
      await get().createConversation({
        ratio: item.ratio,
        size: item.size || getDefaultImageSize(item.ratio),
        quality: item.quality,
        model: item.model,
        n: 1
      }, { silent: true })
      conversationId = get().activeConversationId
    }
    if (!conversationId) return

    const state = get()
    const conversation = state.conversations.find((entry) => entry.id === conversationId) || null
    const generationStartedAt = Date.now()
    const input: GenerateImageInput = {
      conversationId,
      prompt: item.prompt,
      model: item.model || conversation?.model || state.settings?.defaultModel || DEFAULT_MODEL,
      ratio: item.ratio,
      size: item.size || getDefaultImageSize(item.ratio),
      quality: item.quality,
      n: 1,
      outputCompression: conversation?.outputCompression ?? undefined,
      background: conversation?.background || 'auto',
      moderation: conversation?.moderation || 'auto',
      stream: conversation?.stream || false,
      partialImages: conversation?.partialImages ?? undefined,
      inputFidelity: conversation?.inputFidelity ?? undefined,
      outputFormat: conversation?.outputFormat || DEFAULT_IMAGE_OUTPUT_FORMAT,
      referenceImageIds: item.referenceImages.map((reference) => reference.id)
    }

    set({ generationClockMs: generationStartedAt })
    startGenerationClock()
    const nextGenerationState = beginConversationGeneration(conversationId, {
      generatingByConversation: state.generatingByConversation,
      startedAtByConversation: state.generationStartedAtByConversation,
      removedIndexesByRunId: state.removedGenerationIndexesByRunId
    }, generationStartedAt)
    set({
      generatingByConversation: nextGenerationState.generatingByConversation,
      generationStartedAtByConversation: nextGenerationState.startedAtByConversation,
      removedGenerationIndexesByRunId: nextGenerationState.removedIndexesByRunId
    })

    try {
      const resultPromise = window.pictverse.image.generate(input)
      void get().refreshConversationResults(conversationId)
      const result = await resultPromise
      const runs = await window.pictverse.conversation.runs(conversationId)
      const history = await window.pictverse.history.list({ query: state.query, sort: state.sort, favoritesOnly: state.favoritesOnly })
      const runsByConversation = { ...get().runsByConversation, [conversationId]: runs }
      const runningRunIds = collectRunningRunIds(runsByConversation)
      const prunedGenerationState = pruneRemovedGenerationIndexesByRunId(runningRunIds, {
        generatingByConversation: get().generatingByConversation,
        startedAtByConversation: get().generationStartedAtByConversation,
        removedIndexesByRunId: get().removedGenerationIndexesByRunId
      })
      set({
        runsByConversation,
        history,
        removedGenerationIndexesByRunId: prunedGenerationState.removedIndexesByRunId
      })
      const durationText = result.run.durationMs != null ? `，用时 ${formatDuration(result.run.durationMs)}` : ''
      get().notify(result.errorMessage ? `重试失败：${result.errorMessage}${durationText}` : `重试完成${durationText}`)
    } catch (error) {
      get().notify(error instanceof Error ? `重试失败：${error.message}` : '重试失败')
    } finally {
      const nextGenerationState = endConversationGeneration(conversationId, {
        generatingByConversation: get().generatingByConversation,
        startedAtByConversation: get().generationStartedAtByConversation,
        removedIndexesByRunId: get().removedGenerationIndexesByRunId
      })
      set({
        generatingByConversation: nextGenerationState.generatingByConversation,
        generationStartedAtByConversation: nextGenerationState.startedAtByConversation,
        removedGenerationIndexesByRunId: nextGenerationState.removedIndexesByRunId
      })
      if (Object.keys(nextGenerationState.generatingByConversation).length === 0) {
        stopGenerationClock()
      }
    }
  },
  reuseHistory: async (item) => {
    let id = item.conversationId || get().activeConversationId
    if (!id) {
      await get().createConversation()
      id = get().activeConversationId
    }
    if (!id) return
    // 历史记录可能来自不同模型，回填时同样要保证输出格式与目标模型兼容
    const targetConversation = get().conversations.find((item) => item.id === id)
    const fallbackFormat = resolveAllowedOutputFormat(
      item.model,
      targetConversation?.providerId ?? null,
      targetConversation?.outputFormat,
      get().providers
    )
    await window.pictverse.conversation.update(id, {
      draftPrompt: item.prompt,
      model: item.model,
      ratio: item.ratio,
      size: item.size || getDefaultImageSize(item.ratio),
      quality: item.quality,
      ...(fallbackFormat ? { outputFormat: fallbackFormat } : {})
    })
    const conversations = await window.pictverse.conversation.list()
    const runs = await window.pictverse.conversation.runs(id)
    set({ conversations, activeConversationId: id, runsByConversation: { ...get().runsByConversation, [id]: runs }, view: 'workspace' })
    get().notify('已回填到当前会话')
  },
  loadProviders: async () => {
    try {
      const providers = await window.pictverse.provider.list()
      set({
        providers,
        activeProviderId: get().activeProviderId || providers.find((item) => item.isDefault)?.id || providers[0]?.id || null
      })
    } catch (error) {
      console.error('[PictVerse] 供应商加载失败：', error)
    }
  },
  saveProvider: async (input, id) => {
    try {
      const saved = id
        ? await window.pictverse.provider.update(id, input)
        : await window.pictverse.provider.create(input)
      await get().loadProviders()
      set({ activeProviderId: saved.id })
      get().notify(id ? '供应商已更新' : '供应商已创建')
    } catch (error) {
      get().notify(error instanceof Error ? `保存失败：${error.message}` : '保存失败')
    }
  },
  deleteProvider: async (id) => {
    try {
      await window.pictverse.provider.remove(id)
      await get().loadProviders()
      get().notify('供应商已删除')
    } catch (error) {
      get().notify(error instanceof Error ? `删除失败：${error.message}` : '删除失败')
    }
  },
  makeProviderDefault: async (id) => {
    try {
      await window.pictverse.provider.setDefault(id)
      await get().loadProviders()
      get().notify('已设为默认供应商')
    } catch (error) {
      get().notify(error instanceof Error ? `设置失败：${error.message}` : '设置失败')
    }
  },
  fetchProviderModels: async (id) => {
    try {
      const models = await window.pictverse.provider.fetchModels(id)
      get().notify(`获取到 ${models.length} 个模型`)
      return models
    } catch (error) {
      get().notify(error instanceof Error ? `获取模型失败：${error.message}` : '获取模型失败')
      return []
    }
  },
  saveProviderModels: async (id, modelIds) => {
    try {
      await window.pictverse.provider.saveModels(id, modelIds)
      get().notify('模型列表已保存')
    } catch (error) {
      get().notify(error instanceof Error ? `保存模型失败：${error.message}` : '保存模型失败')
    }
  },
  notify: (message) => {
    set({ toast: message })
    if (message) window.setTimeout(() => set({ toast: null }), 1800)
  }
}))
