/**
 * PictVerse 的 MCP 工具面。
 *
 * 所有工具都是既有能力的薄封装：真正的业务逻辑仍在 database / ImageService /
 * PromptService 里，MCP 只负责「把外部 agent 的意图翻译成一次服务调用」，
 * 并强制两条边界：
 *   1. 供应商密钥永不出现在响应里（统一走 dto.ts）；
 *   2. 生成不阻塞等待出图（超时返回 run_id，让 agent 轮询）。
 */
import { mkdirSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, extname, resolve } from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  DEFAULT_IMAGE_OUTPUT_FORMAT,
  getDefaultImageSize,
  getImageQualities,
  getOutputFormatsFor,
  normalizeImageRatio,
  resolveModelCapabilities
} from '@shared/image-options'
import type {
  Conversation,
  ConversationCreateInput,
  ConversationUpdate,
  ImageOutputFormat,
  ImageQuality,
  McpLogEntry
} from '@shared/types'
import { copySelectedHistoryImages } from '../batch-download'
import type { AppDatabase } from '../database'
import type { ImageService } from '../image-service'
import type { PromptService } from '../prompt-service'
import type { SettingsStore } from '../settings'
import { ensureThumbnail } from '../thumbnail-native'
import { buildImageUrl } from './config'
import {
  toPublicConversation,
  toPublicHistory,
  toPublicProvider,
  toPublicReference
} from './dto'
import { buildGenerateInput, type GenerateOverrides } from './generate-input'
import type { McpLogInput } from './log-store'
import type { Semaphore } from './semaphore'

/** 单张内联图上限：超过就只给路径与 URL，避免把上下文撑爆 */
const MAX_INLINE_BYTES = 1.5 * 1024 * 1024
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024
const ALLOWED_REFERENCE_EXTENSIONS = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp']
])

export type McpToolDeps = {
  database: AppDatabase
  imageService: ImageService
  promptService: PromptService
  settings: SettingsStore
  semaphore: Semaphore
  /** 当前监听端口，用于拼图片 URL；服务未运行时返回配置端口 */
  getPort: () => number
  /** 按 MCP 会话 id 反查客户端名，日志里显示「谁在调」 */
  resolveClientName: (sessionId?: string) => string | null
  /** 删除图片后清掉协议层路径缓存 */
  onImageDeleted: (imageId: string) => void
  log: (input: McpLogInput) => void
}

type Handler = (args: Record<string, unknown>, sessionId?: string) => Promise<ToolResult> | ToolResult

type ToolResult = {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
    | { type: 'resource_link'; uri: string; name: string; mimeType?: string; description?: string }
  >
  isError?: boolean
}

export function registerMcpTools(server: McpServer, deps: McpToolDeps): number {
  const definitions: Array<{
    name: string
    title: string
    description: string
    inputSchema: z.ZodRawShape
    handler: Handler
  }> = [
    {
      name: 'list_conversations',
      title: '列出会话',
      description: '列出最近更新的会话（标题、模型、比例、质量、张数、参考图数量）。用于先了解工作台里有什么。',
      inputSchema: { limit: z.number().int().min(1).max(100).optional().describe('返回条数，默认 20') },
      handler: ({ limit }) => {
        const conversations = deps.database.listConversations()
        const items = conversations.slice(0, typeof limit === 'number' ? limit : 20).map(toPublicConversation)
        return ok({ total: conversations.length, items })
      }
    },
    {
      name: 'get_conversation',
      title: '读取会话',
      description: '读取单个会话的完整参数与参考图清单。',
      inputSchema: { conversation_id: z.string().min(1).describe('会话 id') },
      handler: ({ conversation_id }) => {
        const conversation = deps.database.getConversation(String(conversation_id))
        if (!conversation) return fail(`找不到会话：${conversation_id}`)
        return ok(toPublicConversation(conversation))
      }
    },
    {
      name: 'create_conversation',
      title: '新建会话',
      description: '新建一个会话，可指定标题、提示词草稿与生成参数；不填的字段用默认值。',
      inputSchema: {
        title: z.string().max(120).optional().describe('会话标题'),
        draft_prompt: z.string().max(20000).optional().describe('提示词草稿'),
        model: z.string().optional().describe('图片模型'),
        ratio: z.string().optional().describe('比例，如 1:1 / 16:9 / 3:4'),
        size: z.string().optional().describe('尺寸，如 1024x1024'),
        quality: z.string().optional().describe('质量：auto / low / medium / high / xhigh / max'),
        n: z.number().int().min(1).max(10).optional().describe('生成张数'),
        output_format: z.string().optional().describe('输出格式：png / jpeg / webp / svg / gif'),
        provider_id: z.string().optional().describe('指定供应商 id，不填用默认供应商'),
        auto_save_history: z.boolean().optional().describe('是否写入图库，默认 true')
      },
      handler: (args) => {
        const input = normalizeCreateInput(args)
        const conversation = deps.database.createConversation(input)
        const draft = typeof args.draft_prompt === 'string' ? args.draft_prompt : ''
        const title = typeof args.title === 'string' ? args.title.trim() : ''
        const patched = draft || title
          ? deps.database.updateConversation(conversation.id, {
              ...(draft ? { draftPrompt: draft } : {}),
              ...(title ? { title } : {})
            })
          : conversation
        return ok(toPublicConversation(patched))
      }
    },
    {
      name: 'update_conversation',
      title: '修改会话',
      description: '修改会话的标题、提示词草稿或生成参数；只改传入的字段。',
      inputSchema: {
        conversation_id: z.string().min(1).describe('会话 id'),
        title: z.string().max(120).optional(),
        draft_prompt: z.string().max(20000).optional(),
        model: z.string().optional(),
        ratio: z.string().optional(),
        size: z.string().optional(),
        quality: z.string().optional(),
        n: z.number().int().min(1).max(10).optional(),
        output_format: z.string().optional(),
        background: z.string().optional(),
        moderation: z.string().optional(),
        seed: z.number().int().min(0).optional(),
        seed_locked: z.boolean().optional(),
        provider_id: z.string().nullable().optional()
      },
      handler: (args) => {
        const id = String(args.conversation_id)
        const current = deps.database.getConversation(id)
        if (!current) return fail(`找不到会话：${id}`)
        const patch = normalizeUpdateInput(args, current)
        return ok(toPublicConversation(deps.database.updateConversation(id, patch)))
      }
    },
    {
      name: 'generate_image',
      title: '生成图片',
      description:
        '提交一次图片生成并返回结果。单张通常需要 10–90 秒：wait_seconds 内完成会直接给出图片，' +
        '超时则返回 run_id 与 running 状态，请用 get_run 继续轮询（生成不会中断）。',
      inputSchema: {
        conversation_id: z.string().optional().describe('会话 id；不填会自动新建一个会话'),
        prompt: z.string().max(20000).optional().describe('提示词；不填则用会话草稿'),
        model: z.string().optional(),
        ratio: z.string().optional(),
        size: z.string().optional(),
        quality: z.string().optional(),
        n: z.number().int().min(1).max(10).optional(),
        output_format: z.string().optional(),
        background: z.string().optional(),
        moderation: z.string().optional(),
        seed: z.number().int().min(0).optional(),
        reference_image_ids: z.array(z.string()).max(8).optional().describe('参考图 id；不填沿用会话已有参考图'),
        wait_seconds: z.number().int().min(0).max(60).optional().describe('最多等待秒数，默认 25，0 表示立即返回')
      },
      handler: (args) => generateImage(deps, args)
    },
    {
      name: 'get_run',
      title: '查询生成进度',
      description: '查询一次生成轮次的状态、耗时、逐张结果与失败原因。',
      inputSchema: { run_id: z.string().min(1).describe('轮次 id') },
      handler: ({ run_id }) => {
        const run = deps.database.getRun(String(run_id))
        if (!run) return fail(`找不到轮次：${run_id}`)
        return ok(publicRun(deps, run.id, run.status, run.durationMs, run.errorMessage, run.items, run.conversationId, run.createdAt))
      }
    },
    {
      name: 'cancel_run',
      title: '取消生成',
      description: '取消整轮生成；传 request_index 时只取消该序号对应的那一张。',
      inputSchema: {
        run_id: z.string().min(1),
        request_index: z.number().int().min(0).optional().describe('只取消这一张，从 0 开始')
      },
      handler: ({ run_id, request_index }) => {
        deps.imageService.cancelRunGeneration(String(run_id), typeof request_index === 'number' ? request_index : undefined)
        const run = deps.database.getRun(String(run_id))
        return ok({ run_id, status: run?.status ?? 'unknown' })
      }
    },
    {
      name: 'list_images',
      title: '检索图库',
      description: '按关键词、收藏状态和时间检索历史图片。',
      inputSchema: {
        query: z.string().optional().describe('关键词，匹配提示词 / 模型 / 尺寸'),
        favorites_only: z.boolean().optional(),
        sort: z.enum(['newest', 'oldest']).optional(),
        limit: z.number().int().min(1).max(100).optional().describe('默认 20'),
        offset: z.number().int().min(0).optional().describe('跳过条数，默认 0')
      },
      handler: ({ query, favorites_only, sort, limit, offset }) => {
        const all = deps.database.listHistory({
          query: typeof query === 'string' ? query : undefined,
          favoritesOnly: favorites_only === true,
          sort: sort === 'oldest' ? 'oldest' : 'newest'
        })
        const start = typeof offset === 'number' ? offset : 0
        const count = typeof limit === 'number' ? limit : 20
        return ok({
          total: all.length,
          offset: start,
          items: all.slice(start, start + count).map((item) => ({
            ...toPublicHistory(item),
            url: item.status === 'succeeded' ? buildImageUrl(deps.getPort(), item.id) : null
          }))
        })
      }
    },
    {
      name: 'get_image',
      title: '读取单张图片',
      description:
        '读取单张图片的元数据，并可选内联一张缩略图（最长边 512，适合让模型直接「看」到）。' +
        '原图请按返回的 url 自行下载。',
      inputSchema: {
        image_id: z.string().min(1),
        inline_thumbnail: z.boolean().optional().describe('是否内联缩略图，默认 true')
      },
      handler: ({ image_id, inline_thumbnail }) => getImage(deps, String(image_id), inline_thumbnail !== false)
    },
    {
      name: 'favorite_images',
      title: '收藏 / 取消收藏',
      description: '批量设置图片的收藏状态。',
      inputSchema: {
        image_ids: z.array(z.string()).min(1).max(100),
        favorite: z.boolean().describe('true 收藏，false 取消')
      },
      handler: ({ image_ids, favorite }) => {
        const updated: string[] = []
        const missing: string[] = []
        for (const id of dedupeStrings(image_ids as string[])) {
          try {
            deps.database.setFavorite(id, favorite === true)
            updated.push(id)
          } catch {
            missing.push(id)
          }
        }
        return ok({ updated, missing })
      }
    },
    {
      name: 'delete_images',
      title: '删除图片',
      description: '批量删除历史图片，连同磁盘上的原图与缩略图一起删除。此操作不可撤销。',
      inputSchema: { image_ids: z.array(z.string()).min(1).max(100) },
      handler: ({ image_ids }) => {
        const deleted: string[] = []
        const missing: string[] = []
        for (const id of dedupeStrings(image_ids as string[])) {
          if (!deps.database.getHistory(id)) {
            missing.push(id)
            continue
          }
          deps.database.deleteHistory(id)
          deps.onImageDeleted(id)
          deleted.push(id)
        }
        return ok({ deleted, missing })
      }
    },
    {
      name: 'export_images',
      title: '导出图片',
      description: '把选中的图片复制到指定目录（目录不存在会自动创建）。',
      inputSchema: {
        image_ids: z.array(z.string()).min(1).max(100),
        directory: z.string().min(1).describe('目标目录的绝对路径')
      },
      handler: ({ image_ids, directory }) => {
        const raw = String(directory).trim()
        if (!isAbsolute(raw)) return fail('directory 必须是绝对路径。')
        const target = resolve(raw)
        try {
          mkdirSync(target, { recursive: true })
          if (!statSync(target).isDirectory()) return fail(`目标路径不是目录：${target}`)
        } catch (error) {
          return fail(`无法创建目标目录：${error instanceof Error ? error.message : String(error)}`)
        }
        const result = copySelectedHistoryImages({
          ids: dedupeStrings(image_ids as string[]),
          directory: target,
          getHistory: (id) => deps.database.getHistory(id)
        })
        return ok(result)
      }
    },
    {
      name: 'import_reference',
      title: '添加参考图',
      description: '把图库里的一张图或磁盘上的一个图片文件加入会话作为参考图（最多 8 张，单张 ≤ 20MB）。',
      inputSchema: {
        conversation_id: z.string().min(1),
        source: z.enum(['history', 'file']),
        history_id: z.string().optional().describe('source=history 时必填'),
        file_path: z.string().optional().describe('source=file 时必填，绝对路径')
      },
      handler: ({ conversation_id, source, history_id, file_path }) =>
        importReference(deps, String(conversation_id), source as 'history' | 'file', history_id, file_path)
    },
    {
      name: 'optimize_prompt',
      title: '提示词助手',
      description: 'mode=inspire 生成一条新提示词；mode=enrich 丰富并优化已有提示词。需要先配置提示词助手服务。',
      inputSchema: {
        mode: z.enum(['inspire', 'enrich']),
        prompt: z.string().max(20000).optional().describe('mode=enrich 时必填'),
        has_reference_images: z.boolean().optional()
      },
      handler: async ({ mode, prompt, has_reference_images }) => {
        const input = {
          hasReferenceImages: has_reference_images === true,
          ...(typeof prompt === 'string' ? { prompt } : {})
        }
        const text = mode === 'enrich'
          ? await deps.promptService.enrich({ ...input, prompt: String(prompt ?? '') })
          : await deps.promptService.inspire(input)
        return ok({ mode, prompt: text })
      }
    },
    {
      name: 'list_models',
      title: '列出供应商与模型',
      description: '列出已配置的供应商与可用模型、能力开关。出于安全考虑不返回 API Key。',
      inputSchema: {},
      handler: () => {
        const providers = deps.database.listProviders()
        const items = providers.map((provider) =>
          toPublicProvider(
            provider,
            resolveModelCapabilities(provider.defaultModel, provider),
            deps.database.listProviderModels(provider.id).filter((model) => model.added).map((model) => model.modelId)
          )
        )
        const settings = deps.settings.getPublicSettings()
        return ok({
          defaultModel: settings.defaultModel,
          promptModel: settings.promptModel,
          // 只说明「配没配」，不给密钥本身
          apiKeyConfigured: settings.apiKeyStored,
          providers: items
        })
      }
    }
  ]

  for (const definition of definitions) {
    registerOne(server, deps, definition)
  }
  return definitions.length
}

function registerOne(
  server: McpServer,
  deps: McpToolDeps,
  definition: { name: string; title: string; description: string; inputSchema: z.ZodRawShape; handler: Handler }
): void {
  const wrapped = async (args: Record<string, unknown>, extra?: { sessionId?: string }): Promise<ToolResult> => {
    const startedAt = Date.now()
    const logBase = {
      tool: definition.name,
      clientName: deps.resolveClientName(extra?.sessionId),
      summary: summarizeArgs(args)
    }
    try {
      const result = await definition.handler(args ?? {}, extra?.sessionId)
      deps.log({
        ...logBase,
        ok: result.isError !== true,
        durationMs: Date.now() - startedAt,
        error: result.isError ? firstText(result) : null
      })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      deps.log({ ...logBase, ok: false, durationMs: Date.now() - startedAt, error: message })
      return fail(message)
    }
  }

  // SDK 的泛型推导在动态注册场景下过窄，这里只放宽 registerTool 的签名，回调本身仍是强类型
  ;(server.registerTool as unknown as (
    name: string,
    config: { title?: string; description?: string; inputSchema?: z.ZodRawShape },
    cb: (args: Record<string, unknown>, extra?: { sessionId?: string }) => Promise<ToolResult>
  ) => unknown)(definition.name, {
    title: definition.title,
    description: definition.description,
    inputSchema: definition.inputSchema
  }, wrapped)
}

async function generateImage(deps: McpToolDeps, args: Record<string, unknown>): Promise<ToolResult> {
  let conversation: Conversation | null = null
  if (typeof args.conversation_id === 'string' && args.conversation_id.trim()) {
    conversation = deps.database.getConversation(args.conversation_id.trim())
    if (!conversation) return fail(`找不到会话：${args.conversation_id}`)
  } else {
    // 没指定会话就自动建一个：agent 最自然的用法是「给个提示词就出图」
    conversation = deps.database.createConversation({})
  }

  const overrides: GenerateOverrides = {
    prompt: typeof args.prompt === 'string' ? args.prompt : undefined,
    model: typeof args.model === 'string' ? args.model : undefined,
    ratio: typeof args.ratio === 'string' ? args.ratio : undefined,
    size: typeof args.size === 'string' ? args.size : undefined,
    quality: typeof args.quality === 'string' ? args.quality : undefined,
    n: typeof args.n === 'number' ? args.n : undefined,
    outputFormat: typeof args.output_format === 'string' ? args.output_format : undefined,
    background: typeof args.background === 'string' ? args.background : undefined,
    moderation: typeof args.moderation === 'string' ? args.moderation : undefined,
    seed: typeof args.seed === 'number' ? args.seed : undefined,
    referenceImageIds: Array.isArray(args.reference_image_ids) ? (args.reference_image_ids as string[]) : undefined
  }

  const normalized = buildGenerateInput(conversation, overrides)
  if (!normalized.ok) return fail(normalized.error)

  const release = deps.semaphore.tryAcquire()
  if (!release) {
    return fail(
      `当前已有 ${deps.semaphore.maxConcurrent} 个生成任务在跑，请稍后重试（生成不会排队）。`
    )
  }

  // 超时返回时要能认出「这次调用新建的 run」，所以先记下已有 run id
  const knownRunIds = new Set(deps.database.listRuns(conversation.id).map((run) => run.id))
  const waitMs = Math.min(60, Math.max(0, typeof args.wait_seconds === 'number' ? Math.round(args.wait_seconds) : 25)) * 1000

  let finished = false
  const generation = deps.imageService
    .generate(normalized.input)
    .finally(() => {
      finished = true
      // 名额必须等真正结束才还，否则超时返回会让在途任务突破上限
      release()
    })

  const outcome = await Promise.race([
    generation.then((result) => ({ kind: 'done' as const, result })),
    delay(waitMs).then(() => ({ kind: 'timeout' as const }))
  ])

  if (outcome.kind === 'done') {
    return ok(publicRun(
      deps,
      outcome.result.run.id,
      outcome.result.run.status,
      outcome.result.run.durationMs,
      outcome.result.errorMessage ?? null,
      outcome.result.items,
      conversation.id,
      outcome.result.run.createdAt,
      outcome.result.canceled === true
    ))
  }

  const latest = deps.database.listRuns(conversation.id).find((run) => !knownRunIds.has(run.id))
  const runId = latest?.id ?? null
  if (!runId) {
    // 极端情况：还没建 run 就超时（例如正在排队建行），让 agent 用会话查
    return ok({
      status: 'running',
      conversation_id: conversation.id,
      run_id: null,
      hint: `生成已提交但尚未建立轮次，请稍后用 get_run 或 list_images 查询（finished=${finished}）`
    })
  }
  return ok({
    status: 'running',
    conversation_id: conversation.id,
    run_id: runId,
    hint: `已等待 ${waitMs / 1000} 秒仍未完成，生成仍在继续；请用 get_run 轮询该 run_id。`
  })
}

async function getImage(deps: McpToolDeps, imageId: string, inline: boolean): Promise<ToolResult> {
  const item = deps.database.getHistory(imageId)
  if (!item) return fail(`找不到图片：${imageId}`)
  const meta = {
    ...toPublicHistory(item),
    url: item.status === 'succeeded' ? buildImageUrl(deps.getPort(), item.id) : null
  }
  const blocks: ToolResult['content'] = [{ type: 'text', text: JSON.stringify(meta, null, 2) }]
  if (item.status !== 'succeeded' || !item.filePath) return { content: blocks }

  blocks.push({
    type: 'resource_link',
    uri: buildImageUrl(deps.getPort(), item.id),
    name: `${item.id}${extname(item.filePath) || '.png'}`,
    mimeType: mimeTypeFromExtension(extname(item.filePath)),
    description: item.prompt.slice(0, 200)
  })

  if (!inline) return { content: blocks }
  try {
    // 缩略图是纯优化：生成失败就退回原图，再大就只能给路径
    const target = ensureThumbnail(item.filePath) ?? item.filePath
    const size = statSync(target).size
    if (size > MAX_INLINE_BYTES) {
      blocks[0] = {
        type: 'text',
        text: `${JSON.stringify(meta, null, 2)}\n\n（图片 ${(size / 1024 / 1024).toFixed(1)}MB 超过内联上限，已省略内联图，请按 url 下载。）`
      }
      return { content: blocks }
    }
    blocks.push({
      type: 'image',
      data: readFileSync(target).toString('base64'),
      mimeType: mimeTypeFromExtension(extname(target))
    })
  } catch (error) {
    blocks.push({ type: 'text', text: `内联缩略图失败：${error instanceof Error ? error.message : String(error)}` })
  }
  return { content: blocks }
}

function importReference(
  deps: McpToolDeps,
  conversationId: string,
  source: 'history' | 'file',
  historyId: unknown,
  filePath: unknown
): ToolResult {
  if (!deps.database.getConversation(conversationId)) return fail(`找不到会话：${conversationId}`)
  const references = () => deps.database.listConversationReferences(conversationId).map(toPublicReference)

  if (source === 'history') {
    const id = typeof historyId === 'string' ? historyId.trim() : ''
    if (!id) return fail('source=history 时必须提供 history_id。')
    const reference = deps.database.addHistoryImageAsReference(conversationId, id)
    return ok({ added: toPublicReference(reference), references: references() })
  }

  const raw = typeof filePath === 'string' ? filePath.trim() : ''
  if (!raw) return fail('source=file 时必须提供 file_path。')
  if (!isAbsolute(raw)) return fail('file_path 必须是绝对路径。')
  const target = resolve(raw)
  const extension = extname(target).toLowerCase()
  const mimeType = ALLOWED_REFERENCE_EXTENSIONS.get(extension)
  if (!mimeType) return fail(`不支持的图片格式：${extension || '（无扩展名）'}，仅支持 png / jpg / jpeg / webp。`)

  let buffer: Buffer
  try {
    const size = statSync(target).size
    if (size > MAX_REFERENCE_BYTES) return fail('单张参考图不能超过 20MB。')
    buffer = readFileSync(target)
  } catch (error) {
    return fail(`读取文件失败：${error instanceof Error ? error.message : String(error)}`)
  }

  const reference = deps.database.createReferenceImageFromBytes({
    conversationId,
    name: target.split(/[\\/]/).pop() || `reference${extension}`,
    mimeType,
    data: buffer
  })
  return ok({ added: toPublicReference(reference), references: references() })
}

function publicRun(
  deps: McpToolDeps,
  runId: string,
  status: string,
  durationMs: number | null,
  errorMessage: string | null,
  items: Array<{ id: string; status: string; filePath: string | null; requestIndex: number | null; errorMessage: string | null; prompt: string }>,
  conversationId: string,
  createdAt: string,
  canceled = false
): Record<string, unknown> {
  return {
    run_id: runId,
    conversation_id: conversationId,
    status,
    canceled,
    duration_ms: durationMs,
    error_message: errorMessage,
    created_at: createdAt,
    images: items
      .filter((item) => item.status === 'succeeded')
      .map((item) => ({
        image_id: item.id,
        url: buildImageUrl(deps.getPort(), item.id),
        file_path: item.filePath,
        request_index: item.requestIndex
      })),
    failed: items
      .filter((item) => item.status !== 'succeeded')
      .map((item) => ({
        image_id: item.id,
        request_index: item.requestIndex,
        error_message: item.errorMessage
      }))
  }
}

function normalizeCreateInput(args: Record<string, unknown>): ConversationCreateInput {
  const ratio = args.ratio === undefined ? undefined : normalizeImageRatio(args.ratio)
  const model = typeof args.model === 'string' ? args.model.trim() : undefined
  const qualities = model ? getImageQualities(model) : getImageQualities('')
  const quality = typeof args.quality === 'string' && qualities.includes(args.quality as ImageQuality)
    ? (args.quality as ImageQuality)
    : undefined
  const formats = model ? getOutputFormatsFor(model) : getOutputFormatsFor('')
  const outputFormat = typeof args.output_format === 'string' && formats.includes(args.output_format as ImageOutputFormat)
    ? (args.output_format as ImageOutputFormat)
    : undefined
  const size = typeof args.size === 'string' && args.size.trim() ? args.size.trim() : undefined

  return {
    ...(model ? { model } : {}),
    ...(ratio ? { ratio } : {}),
    ...(size ? { size } : {}),
    ...(quality ? { quality } : {}),
    ...(typeof args.n === 'number' ? { n: args.n } : {}),
    ...(outputFormat ? { outputFormat } : {}),
    ...(typeof args.provider_id === 'string' && args.provider_id.trim() ? { providerId: args.provider_id.trim() } : {}),
    ...(typeof args.auto_save_history === 'boolean' ? { autoSaveHistory: args.auto_save_history } : {})
  }
}

function normalizeUpdateInput(args: Record<string, unknown>, current: Conversation): ConversationUpdate {
  const patch: ConversationUpdate = {}
  if (typeof args.title === 'string') patch.title = args.title.trim().slice(0, 120) || current.title
  if (typeof args.draft_prompt === 'string') patch.draftPrompt = args.draft_prompt
  if (typeof args.model === 'string' && args.model.trim()) patch.model = args.model.trim()
  if (args.ratio !== undefined) {
    patch.ratio = normalizeImageRatio(args.ratio)
    patch.size = getDefaultImageSize(patch.ratio)
  }
  if (typeof args.size === 'string' && args.size.trim()) patch.size = args.size.trim()
  if (typeof args.quality === 'string') {
    const model = patch.model ?? current.model
    if (getImageQualities(model).includes(args.quality as ImageQuality)) patch.quality = args.quality as ImageQuality
  }
  if (typeof args.n === 'number') patch.n = args.n
  if (typeof args.output_format === 'string') {
    const model = patch.model ?? current.model
    if (getOutputFormatsFor(model).includes(args.output_format as ImageOutputFormat)) {
      patch.outputFormat = args.output_format as ImageOutputFormat
    }
  }
  if (typeof args.background === 'string') patch.background = args.background as Conversation['background']
  if (typeof args.moderation === 'string') patch.moderation = args.moderation as Conversation['moderation']
  if (typeof args.seed === 'number') patch.seed = args.seed
  if (typeof args.seed_locked === 'boolean') patch.seedLocked = args.seed_locked
  if (args.provider_id === null) patch.providerId = null
  else if (typeof args.provider_id === 'string' && args.provider_id.trim()) patch.providerId = args.provider_id.trim()
  return patch
}

function ok(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function fail(message: string): ToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] }
}

function firstText(result: ToolResult): string {
  const block = result.content.find((item) => item.type === 'text')
  return block && block.type === 'text' ? block.text : '工具调用失败'
}

/** 日志摘要：只留结构性信息，避免把整段提示词写进日志 */
export function summarizeArgs(args: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(args ?? {})) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string') {
      const text = value.length > 40 ? `${value.slice(0, 40)}…` : value
      parts.push(`${key}=${text}`)
    } else if (Array.isArray(value)) {
      parts.push(`${key}[${value.length}]`)
    } else {
      parts.push(`${key}=${String(value)}`)
    }
  }
  return parts.join(' ')
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => typeof value === 'string' && value.trim())))
}

function mimeTypeFromExtension(extension: string): string {
  const normalized = extension.toLowerCase()
  if (normalized === '.jpg' || normalized === '.jpeg') return 'image/jpeg'
  if (normalized === '.webp') return 'image/webp'
  if (normalized === '.gif') return 'image/gif'
  if (normalized === '.svg') return 'image/svg+xml'
  return 'image/png'
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export type { McpLogEntry }
