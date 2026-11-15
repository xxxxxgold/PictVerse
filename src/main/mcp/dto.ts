/**
 * 对外 DTO 投影：所有通过 MCP 输出的对象都要经过这里。
 *
 * 原因：Provider.apiKey 在 shared/types 里是明文，数据库整条记录直接序列化就会
 * 把密钥交给外部 agent。这条边界一旦破了，等于把 API Key 公开。
 */
import type { Conversation, ImageHistoryItem, McpLogEntry, Provider, ReferenceImage } from '@shared/types'

export type PublicProvider = {
  id: string
  name: string
  baseURL: string
  defaultModel: string
  promptModel: string | null
  isDefault: boolean
  /** 是否配了密钥，只给布尔，不给值 */
  apiKeyConfigured: boolean
  capabilities: { mask: boolean; gif: boolean; svg: boolean }
  models: string[]
}

export type PublicConversation = {
  id: string
  title: string
  draftPrompt: string
  model: string
  providerId: string | null
  ratio: string
  size: string
  quality: string
  n: number
  outputFormat: string
  background: string
  moderation: string
  seed: number | null
  seedLocked: boolean
  autoSaveHistory: boolean
  referenceImageCount: number
  referenceImages: PublicReferenceImage[]
  createdAt: string
  updatedAt: string
}

export type PublicReferenceImage = {
  id: string
  name: string
  mimeType: string
  fileSizeBytes: number
  createdAt: string
}

export type PublicHistoryItem = {
  id: string
  conversationId: string | null
  runId: string | null
  prompt: string
  model: string
  ratio: string
  size: string | null
  quality: string
  status: string
  generationMode: string
  favorite: boolean
  filePath: string | null
  fileSizeBytes: number | null
  durationMs: number | null
  errorMessage: string | null
  createdAt: string
}

export function toPublicProvider(
  provider: Provider,
  capabilities: { mask: boolean; gif: boolean; svg: boolean },
  models: string[]
): PublicProvider {
  return {
    id: provider.id,
    name: provider.name,
    baseURL: provider.baseURL,
    defaultModel: provider.defaultModel,
    promptModel: provider.promptModel,
    isDefault: provider.isDefault,
    // 只暴露「配没配」，绝不暴露值本身
    apiKeyConfigured: Boolean(provider.apiKey),
    capabilities,
    models
  }
}

export function toPublicReference(reference: ReferenceImage): PublicReferenceImage {
  return {
    id: reference.id,
    name: reference.name,
    mimeType: reference.mimeType,
    fileSizeBytes: reference.fileSizeBytes,
    createdAt: reference.createdAt
  }
}

export function toPublicConversation(conversation: Conversation): PublicConversation {
  return {
    id: conversation.id,
    title: conversation.title,
    draftPrompt: conversation.draftPrompt,
    model: conversation.model,
    providerId: conversation.providerId,
    ratio: conversation.ratio,
    size: conversation.size,
    quality: conversation.quality,
    n: conversation.n,
    outputFormat: conversation.outputFormat,
    background: conversation.background,
    moderation: conversation.moderation,
    seed: conversation.seed,
    seedLocked: conversation.seedLocked,
    autoSaveHistory: conversation.autoSaveHistory,
    referenceImageCount: conversation.referenceImages.length,
    referenceImages: conversation.referenceImages.map(toPublicReference),
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt
  }
}

export function toPublicHistory(item: ImageHistoryItem): PublicHistoryItem {
  return {
    id: item.id,
    conversationId: item.conversationId,
    runId: item.runId,
    prompt: item.prompt,
    model: item.model,
    ratio: item.ratio,
    size: item.size,
    quality: item.quality,
    status: item.status,
    generationMode: item.generationMode,
    favorite: item.favorite,
    filePath: item.filePath,
    fileSizeBytes: item.fileSizeBytes,
    durationMs: item.durationMs,
    errorMessage: item.errorMessage,
    createdAt: item.createdAt
  }
}

/** 日志本身就是给人看的，投影只保证字段齐全 */
export function toPublicLog(entry: McpLogEntry): McpLogEntry {
  return { ...entry }
}
