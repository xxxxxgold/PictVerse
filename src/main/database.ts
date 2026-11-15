import { copyFileSync, existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { DEFAULT_IMAGE_OUTPUT_FORMAT, DEFAULT_MODEL, getDefaultImageSize, normalizeCapabilityOverride } from '@shared/image-options'
import type {
  CapabilityOverride,
  ConversationCreateInput,
  Conversation,
  ConversationUpdate,
  GenerationRun,
  GenerationRunStatus,
  HistoryListOptions,
  ImageHistoryItem,
  ImageRatio,
  ImageStatus,
  Provider,
  ProviderInput,
  ProviderModel,
  ReferenceImage
} from '@shared/types'
import { createInterruptedRunRecoveryPlan } from './interrupted-run-recovery'
import { isPathInside } from './path-guard'
import { derivedImagePaths } from './thumbnail'

type Row = Record<string, unknown>

export const MAX_REFERENCE_IMAGES = 8
export const MAX_REFERENCE_IMAGE_BYTES = 20 * 1024 * 1024

const referenceMimeTypes = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/webp', '.webp']
])

export class AppDatabase {
  readonly imagesDir: string
  readonly referenceImagesDir: string
  /** 用户配置的额外图片根目录（imagesRoot），删除守卫需要覆盖它 */
  private extraImageRoot: string | null = null
  private readonly db: Database.Database

  constructor(userDataDir: string) {
    mkdirSync(userDataDir, { recursive: true })
    this.imagesDir = join(userDataDir, 'images')
    this.referenceImagesDir = join(userDataDir, 'reference-images')
    mkdirSync(this.imagesDir, { recursive: true })
    mkdirSync(this.referenceImagesDir, { recursive: true })
    this.db = new Database(join(userDataDir, 'pictverse.sqlite'))
    this.db.pragma('journal_mode = WAL')
    this.migrate()
  }

  close(): void {
    this.db.close()
  }

  listConversations(): Conversation[] {
    return this.db.prepare('select * from conversations order by updated_at desc').all().map((row) => this.conversationFromRow(row as Row))
  }

  getConversation(id: string): Conversation | null {
    const row = this.db.prepare('select * from conversations where id = ?').get(id) as Row | undefined
    return row ? this.conversationFromRow(row) : null
  }

  createConversation(input: ConversationCreateInput = {}): Conversation {
    const now = new Date().toISOString()
    const ratio = input.ratio || '1:1'
    const conversation: Conversation = {
      id: randomUUID(),
      title: '新会话',
      draftPrompt: '',
      model: input.model || DEFAULT_MODEL,
      ratio,
      size: input.size || getDefaultImageSize(ratio),
      quality: input.quality || 'high',
      n: input.n !== undefined ? Math.min(10, Math.max(1, input.n)) : 1,
      providerId: input.providerId ?? null,
      outputFormat: input.outputFormat || DEFAULT_IMAGE_OUTPUT_FORMAT,
      outputCompression: input.outputCompression ?? null,
      background: input.background || 'auto',
      moderation: input.moderation || 'auto',
      stream: input.stream || false,
      partialImages: input.partialImages ?? 0,
      inputFidelity: input.inputFidelity ?? null,
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
    this.db
      .prepare(
        `insert into conversations
        (id, title, draft_prompt, model, provider_id, ratio, size, quality, n, output_format, output_compression, background, moderation, stream, partial_images, input_fidelity, complexity, frame_count, frame_duration_ms, seed, seed_locked, auto_save_history, keep_failure_details, created_at, updated_at)
        values (@id, @title, @draftPrompt, @model, @providerId, @ratio, @size, @quality, @n, @outputFormat, @outputCompression, @background, @moderation, @stream, @partialImages, @inputFidelity, @complexity, @frameCount, @frameDurationMs, @seed, @seedLocked, @autoSaveHistory, @keepFailureDetails, @createdAt, @updatedAt)`
      )
      .run({
        ...conversation,
        outputCompression: conversation.outputCompression,
        stream: conversation.stream ? 1 : 0,
        seedLocked: conversation.seedLocked ? 1 : 0,
        autoSaveHistory: conversation.autoSaveHistory ? 1 : 0,
        keepFailureDetails: conversation.keepFailureDetails ? 1 : 0
      })
    return conversation
  }

  updateConversation(id: string, input: ConversationUpdate): Conversation {
    const current = this.getConversation(id)
    if (!current) throw new Error('Conversation not found.')
    const next: Conversation = {
      ...current,
      ...input,
      size: input.size ?? (input.ratio !== undefined ? getDefaultImageSize(input.ratio) : current.size),
      n: input.n !== undefined ? Math.min(10, Math.max(1, input.n)) : current.n,
      outputFormat: input.outputFormat ?? current.outputFormat,
      outputCompression: input.outputCompression !== undefined ? input.outputCompression : current.outputCompression,
      background: input.background ?? current.background,
      moderation: input.moderation ?? current.moderation,
      stream: input.stream !== undefined ? input.stream : current.stream,
      partialImages: input.partialImages !== undefined ? input.partialImages : current.partialImages,
      inputFidelity: input.inputFidelity !== undefined ? input.inputFidelity : current.inputFidelity,
      providerId: input.providerId !== undefined ? input.providerId : current.providerId,
      complexity: input.complexity !== undefined ? input.complexity : current.complexity,
      frameCount: input.frameCount !== undefined ? input.frameCount : current.frameCount,
      frameDurationMs: input.frameDurationMs !== undefined ? input.frameDurationMs : current.frameDurationMs,
      seed: input.seed !== undefined ? input.seed : current.seed,
      seedLocked: input.seedLocked !== undefined ? input.seedLocked : current.seedLocked,
      updatedAt: new Date().toISOString()
    }
    this.db
      .prepare(
        `update conversations set
        title = @title,
        draft_prompt = @draftPrompt,
        model = @model,
        ratio = @ratio,
        size = @size,
        quality = @quality,
        n = @n,
        output_format = @outputFormat,
        output_compression = @outputCompression,
        background = @background,
        moderation = @moderation,
        stream = @stream,
        partial_images = @partialImages,
        input_fidelity = @inputFidelity,
        provider_id = @providerId,
        complexity = @complexity,
        frame_count = @frameCount,
        frame_duration_ms = @frameDurationMs,
        seed = @seed,
        seed_locked = @seedLocked,
        auto_save_history = @autoSaveHistory,
        keep_failure_details = @keepFailureDetails,
        updated_at = @updatedAt
        where id = @id`
      )
      .run({
        ...next,
        stream: next.stream ? 1 : 0,
        seedLocked: next.seedLocked ? 1 : 0,
        autoSaveHistory: next.autoSaveHistory ? 1 : 0,
        keepFailureDetails: next.keepFailureDetails ? 1 : 0
      })
    return next
  }

  deleteConversation(id: string): void {
    // 参考图属于会话：删会话必须连带解除关联、删行、删磁盘文件，
    // 否则每删一个带参考图的会话都会留下 DB 行与最多 8×20MB 的孤儿文件。
    const referenceIds = this.listConversationReferences(id).map((reference) => reference.id)
    const transaction = this.db.transaction(() => {
      this.db.prepare('update image_history set conversation_id = null where conversation_id = ?').run(id)
      this.db.prepare('delete from generation_run_references where run_id in (select id from generation_runs where conversation_id = ?)').run(id)
      this.db.prepare('delete from generation_runs where conversation_id = ?').run(id)
      this.db.prepare('delete from conversation_reference_images where conversation_id = ?').run(id)
      this.db.prepare('delete from conversations where id = ?').run(id)
    })
    transaction()
    for (const referenceId of referenceIds) this.deleteReferenceImageIfUnused(referenceId)
  }

  insertRun(input: Omit<GenerationRun, 'items' | 'referenceImages'> & { referenceImages?: ReferenceImage[] }): GenerationRun {
    this.db
      .prepare(
        `insert into generation_runs
        (id, conversation_id, prompt, model, ratio, size, quality, duration_ms, n, status, error_message, error_details, generation_mode, created_at)
        values (@id, @conversationId, @prompt, @model, @ratio, @size, @quality, @durationMs, @n, @status, @errorMessage, @errorDetails, @generationMode, @createdAt)`
      )
      .run({ ...input, generationMode: input.generationMode || 'text-to-image' })
    return { ...input, referenceImages: input.referenceImages || [], items: [] }
  }

  updateRun(id: string, input: Partial<Pick<GenerationRun, 'status' | 'errorMessage' | 'errorDetails' | 'durationMs'>>): GenerationRun {
    const current = this.getRun(id)
    if (!current) throw new Error('Generation run not found.')
    const next = { ...current, ...input }
    this.db
      .prepare('update generation_runs set status = ?, error_message = ?, error_details = ?, duration_ms = ? where id = ?')
      .run(next.status, next.errorMessage, next.errorDetails, next.durationMs, id)
    return this.getRun(id) || next
  }

  /**
   * 一次性清理历史版本遗留的孤儿数据（启动时调用）。
   *
   * 旧版 deleteConversation / removeReferenceFromConversation 只删关联表，
   * 存量用户库里因此会留下：指向已删会话的关联行、run、历史项，
   * 以及没有任何会话引用的参考图行与磁盘文件。这里把它们一次性收干净。
   */
  cleanupOrphanedReferences(): { rows: number; files: number } {
    // 先清悬空关联行：否则「指向已删会话的关联」会把本该回收的参考图判成仍在使用
    const transaction = this.db.transaction(() => {
      // 历史项保留（删会话的设计是解绑而非删除），只把悬空指针置空
      this.db.prepare(`
        update image_history set conversation_id = null
        where conversation_id is not null
          and conversation_id not in (select id from conversations)
      `).run()
      // 会话已不存在的 run 属于脏数据，直接删；其参考图快照随之清理
      this.db.prepare(`
        delete from generation_runs
        where conversation_id not in (select id from conversations)
      `).run()
      this.db.prepare(`
        delete from conversation_reference_images
        where conversation_id not in (select id from conversations)
      `).run()
      this.db.prepare(`
        delete from generation_run_references
        where run_id not in (select id from generation_runs)
      `).run()
    })
    transaction()

    const orphanIds = this.db
      .prepare(`
        select id from reference_images
        where id not in (select reference_image_id from conversation_reference_images)
          and id not in (select reference_image_id from generation_run_references)
      `)
      .all() as Array<{ id: string }>

    let rows = 0
    let files = 0
    for (const { id } of orphanIds) {
      const row = this.db.prepare('select file_path from reference_images where id = ?').get(id) as
        | { file_path: string | null }
        | undefined
      this.db.prepare('delete from reference_images where id = ?').run(id)
      rows += 1
      const filePath = row?.file_path
      if (!filePath) continue
      const resolved = resolve(filePath)
      if (!isPathInside(resolve(this.referenceImagesDir), resolved)) continue
      try {
        if (existsSync(resolved)) {
          unlinkSync(resolved)
          files += 1
        }
      } catch {
        // 文件被占用：行已清掉，残留文件不影响功能
      }
    }
    return { rows, files }
  }

  recoverInterruptedRuns(now = new Date()): number {
    const runningRuns = this.db.prepare('select id from generation_runs where status = ?').all('running') as Array<{ id: string }>
    if (runningRuns.length === 0) {
      return 0
    }

    const transaction = this.db.transaction(() => {
      for (const { id } of runningRuns) {
        this.recoverInterruptedRun(id, now)
      }
    })
    transaction()
    return runningRuns.length
  }

  getRun(id: string): GenerationRun | null {
    const row = this.db.prepare('select * from generation_runs where id = ?').get(id) as Row | undefined
    return row ? this.runFromRow(row) : null
  }

  listRuns(conversationId: string): GenerationRun[] {
    return this.db
      .prepare('select * from generation_runs where conversation_id = ? order by created_at desc')
      .all(conversationId)
      .map((row) => this.runFromRow(row as Row))
  }

  insertHistory(input: Omit<ImageHistoryItem, 'favorite' | 'referenceImages'> & {
    favorite?: boolean
    globalVisible?: boolean
    referenceImages?: ReferenceImage[]
  }): ImageHistoryItem {
    const item: ImageHistoryItem = { ...input, favorite: Boolean(input.favorite), referenceImages: input.referenceImages || [] }
    this.db
      .prepare(
        `insert into image_history
        (id, conversation_id, run_id, prompt, model, ratio, size, quality, request_index, duration_ms, file_path, file_size_bytes, status, error_message, error_details, favorite, global_visible, generation_mode, created_at)
        values (@id, @conversationId, @runId, @prompt, @model, @ratio, @size, @quality, @requestIndex, @durationMs, @filePath, @fileSizeBytes, @status, @errorMessage, @errorDetails, @favorite, @globalVisible, @generationMode, @createdAt)`
      )
      .run({ ...item, favorite: item.favorite ? 1 : 0, globalVisible: input.globalVisible === false ? 0 : 1, generationMode: input.generationMode || 'text-to-image' })
    return item
  }

  listHistory(options: HistoryListOptions = {}): ImageHistoryItem[] {
    const where: string[] = ['global_visible = 1']
    const params: Record<string, unknown> = {}
    if (options.query?.trim()) {
      where.push('(prompt like @query or model like @query or size like @query)')
      params.query = `%${options.query.trim()}%`
    }
    if (options.favoritesOnly) where.push('favorite = 1')
    const order = options.sort === 'oldest' ? 'asc' : 'desc'
    const sql = `select * from image_history ${where.length ? `where ${where.join(' and ')}` : ''} order by created_at ${order}`
    return this.db.prepare(sql).all(params).map((row) => this.historyFromRow(row as Row))
  }

  getHistory(id: string): ImageHistoryItem | null {
    const row = this.db.prepare('select * from image_history where id = ?').get(id) as Row | undefined
    return row ? this.historyFromRow(row) : null
  }

  setFavorite(id: string, favorite: boolean): ImageHistoryItem {
    this.db.prepare('update image_history set favorite = ? where id = ?').run(favorite ? 1 : 0, id)
    const item = this.getHistory(id)
    if (!item) throw new Error('History item not found.')
    return item
  }

  deleteHistory(id: string): void {
    const item = this.getHistory(id)
    if (item?.filePath) this.deleteImageFile(item.filePath)
    this.db.prepare('delete from image_history where id = ?').run(id)
  }

  getReferenceImage(id: string): ReferenceImage | null {
    const row = this.db.prepare('select * from reference_images where id = ?').get(id) as Row | undefined
    return row ? this.referenceFromRow(row) : null
  }

  listConversationReferences(conversationId: string): ReferenceImage[] {
    return this.db
      .prepare(`
        select reference_images.* from conversation_reference_images
        join reference_images on reference_images.id = conversation_reference_images.reference_image_id
        where conversation_reference_images.conversation_id = ?
        order by conversation_reference_images.position asc, conversation_reference_images.created_at asc
      `)
      .all(conversationId)
      .map((row) => this.referenceFromRow(row as Row))
  }

  createReferenceImageFromBytes(input: {
    conversationId: string
    name: string
    mimeType: string
    data: ArrayBuffer | Uint8Array
  }): ReferenceImage {
    const current = this.listConversationReferences(input.conversationId)
    if (current.length >= MAX_REFERENCE_IMAGES) {
      throw new Error(`最多只能添加 ${MAX_REFERENCE_IMAGES} 张参考图。`)
    }

    const mimeType = normalizeReferenceMimeType(input.mimeType, input.name)
    const buffer = Buffer.from(input.data instanceof Uint8Array ? input.data : new Uint8Array(input.data))
    if (buffer.length > MAX_REFERENCE_IMAGE_BYTES) {
      throw new Error('单张参考图不能超过 20MB。')
    }

    const now = new Date().toISOString()
    const id = randomUUID()
    const extension = referenceMimeTypes.get(mimeType) || extensionFromName(input.name) || '.png'
    const filePath = join(this.referenceImagesDir, `${id}${extension}`)
    writeFileSync(filePath, buffer)
    const reference = this.insertReferenceImage({
      id,
      name: input.name || `reference-${current.length + 1}${extension}`,
      mimeType,
      filePath,
      fileSizeBytes: buffer.length,
      createdAt: now
    })
    this.attachReferenceToConversation(input.conversationId, reference.id, current.length)
    return reference
  }

  addHistoryImageAsReference(conversationId: string, historyId: string): ReferenceImage {
    const current = this.listConversationReferences(conversationId)
    if (current.length >= MAX_REFERENCE_IMAGES) {
      throw new Error(`最多只能添加 ${MAX_REFERENCE_IMAGES} 张参考图。`)
    }
    const item = this.getHistory(historyId)
    if (!item?.filePath || !existsSync(item.filePath)) {
      throw new Error('Image file not found.')
    }

    const now = new Date().toISOString()
    const id = randomUUID()
    const extension = extname(item.filePath) || '.png'
    const filePath = join(this.referenceImagesDir, `${id}${extension}`)
    copyFileSync(item.filePath, filePath)
    const fileSizeBytes = this.getImageFileSize(filePath) || 0
    const reference = this.insertReferenceImage({
      id,
      name: basename(item.filePath),
      mimeType: mimeTypeFromExtension(extension),
      filePath,
      fileSizeBytes,
      createdAt: now
    })
    this.attachReferenceToConversation(conversationId, reference.id, current.length)
    return reference
  }

  removeReferenceFromConversation(conversationId: string, referenceImageId: string): ReferenceImage[] {
    this.db
      .prepare('delete from conversation_reference_images where conversation_id = ? and reference_image_id = ?')
      .run(conversationId, referenceImageId)
    // 「移除」对用户意味着这张参考图不再存在，行与文件都要回收；
    // 仍被其它会话或历史 run 引用时保留，避免把别人的图删掉。
    this.deleteReferenceImageIfUnused(referenceImageId)
    return this.compactConversationReferencePositions(conversationId)
  }

  /**
   * 参考图行 + 磁盘文件的回收守卫。
   * 只要还有会话关联或历史 run 引用，就说明这张图仍在使用，跳过删除。
   */
  private deleteReferenceImageIfUnused(referenceImageId: string): void {
    const stillAttached = this.db
      .prepare('select 1 from conversation_reference_images where reference_image_id = ? limit 1')
      .get(referenceImageId)
    if (stillAttached) return
    const stillReferencedByRun = this.db
      .prepare('select 1 from generation_run_references where reference_image_id = ? limit 1')
      .get(referenceImageId)
    if (stillReferencedByRun) return

    const row = this.db.prepare('select file_path from reference_images where id = ?').get(referenceImageId) as
      | { file_path: string | null }
      | undefined
    this.db.prepare('delete from reference_images where id = ?').run(referenceImageId)
    const filePath = row?.file_path
    if (!filePath) return
    const resolved = resolve(filePath)
    // 只删 reference-images 目录内的文件，防止脏 DB 行把删除引到用户目录
    if (!isPathInside(resolve(this.referenceImagesDir), resolved)) return
    try {
      if (existsSync(resolved)) unlinkSync(resolved)
    } catch {
      // 文件被占用或已删除：行已清掉，残留文件不影响功能
    }
  }

  reorderConversationReferences(conversationId: string, referenceImageIds: string[]): ReferenceImage[] {
    const currentIds = new Set(this.listConversationReferences(conversationId).map((reference) => reference.id))
    const orderedIds = referenceImageIds.filter((id) => currentIds.has(id))
    const missingIds = Array.from(currentIds).filter((id) => !orderedIds.includes(id))
    const nextIds = [...orderedIds, ...missingIds].slice(0, MAX_REFERENCE_IMAGES)
    const updatePosition = this.db.prepare(
      'update conversation_reference_images set position = ? where conversation_id = ? and reference_image_id = ?'
    )
    const transaction = this.db.transaction(() => {
      nextIds.forEach((id, index) => updatePosition.run(index, conversationId, id))
    })
    transaction()
    return this.listConversationReferences(conversationId)
  }

  insertRunReferences(runId: string, references: ReferenceImage[]): void {
    const insert = this.db.prepare(`
      insert into generation_run_references
      (run_id, reference_image_id, position, name, mime_type, file_path, file_size_bytes, created_at)
      values (@runId, @referenceImageId, @position, @name, @mimeType, @filePath, @fileSizeBytes, @createdAt)
    `)
    const transaction = this.db.transaction(() => {
      references.forEach((reference, position) => {
        insert.run({
          runId,
          referenceImageId: reference.id,
          position,
          name: reference.name,
          mimeType: reference.mimeType,
          filePath: reference.filePath,
          fileSizeBytes: reference.fileSizeBytes,
          createdAt: reference.createdAt
        })
      })
    })
    transaction()
  }

  private migrate(): void {
    this.db.exec(`
      create table if not exists conversations (
        id text primary key,
        title text not null,
        draft_prompt text not null,
        model text not null,
        ratio text not null,
        size text,
        quality text not null,
        n integer not null,
        output_format text not null default 'png',
        output_compression integer,
        background text not null default 'auto',
        moderation text not null default 'auto',
        stream integer not null default 0,
        partial_images integer not null default 0,
        input_fidelity text,
        auto_save_history integer not null,
        keep_failure_details integer not null,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists generation_runs (
        id text primary key,
        conversation_id text not null,
        prompt text not null,
        model text not null,
        ratio text not null,
        size text,
        quality text not null,
        request_index integer,
        duration_ms integer,
        n integer not null,
        status text not null,
        error_message text,
        error_details text,
        generation_mode text not null default 'text-to-image',
        created_at text not null
      );

      create table if not exists image_history (
        id text primary key,
        conversation_id text,
        run_id text,
        prompt text not null,
        model text not null,
        ratio text not null,
        size text,
        quality text not null,
        duration_ms integer,
        file_path text,
        file_size_bytes integer,
        status text not null,
        error_message text,
        error_details text,
        favorite integer not null default 0,
        global_visible integer not null default 1,
        generation_mode text not null default 'text-to-image',
        created_at text not null
      );

      create table if not exists reference_images (
        id text primary key,
        name text not null,
        mime_type text not null,
        file_path text not null,
        file_size_bytes integer not null,
        created_at text not null
      );

      create table if not exists conversation_reference_images (
        conversation_id text not null,
        reference_image_id text not null,
        position integer not null,
        created_at text not null,
        primary key (conversation_id, reference_image_id)
      );

      create table if not exists generation_run_references (
        run_id text not null,
        reference_image_id text not null,
        position integer not null,
        name text not null,
        mime_type text not null,
        file_path text,
        file_size_bytes integer not null,
        created_at text not null,
        primary key (run_id, reference_image_id)
      );
    `)
    const conversationColumns = this.db.prepare('pragma table_info(conversations)').all() as Array<{ name: string }>
    if (!conversationColumns.some((column) => column.name === 'size')) {
      this.db.exec('alter table conversations add column size text')
    }
    if (!conversationColumns.some((column) => column.name === 'output_format')) {
      this.db.exec("alter table conversations add column output_format text not null default 'png'")
    }
    if (!conversationColumns.some((column) => column.name === 'output_compression')) {
      this.db.exec('alter table conversations add column output_compression integer')
    }
    if (!conversationColumns.some((column) => column.name === 'background')) {
      this.db.exec("alter table conversations add column background text not null default 'auto'")
    }
    if (!conversationColumns.some((column) => column.name === 'moderation')) {
      this.db.exec("alter table conversations add column moderation text not null default 'auto'")
    }
    if (!conversationColumns.some((column) => column.name === 'stream')) {
      this.db.exec('alter table conversations add column stream integer not null default 0')
    }
    if (!conversationColumns.some((column) => column.name === 'partial_images')) {
      this.db.exec('alter table conversations add column partial_images integer not null default 0')
    }
    if (!conversationColumns.some((column) => column.name === 'input_fidelity')) {
      this.db.exec('alter table conversations add column input_fidelity text')
    }
    const columns = this.db.prepare('pragma table_info(image_history)').all() as Array<{ name: string }>
    if (!columns.some((column) => column.name === 'global_visible')) {
      this.db.exec('alter table image_history add column global_visible integer not null default 1')
    }
    if (!columns.some((column) => column.name === 'duration_ms')) {
      this.db.exec('alter table image_history add column duration_ms integer')
    }
    if (!columns.some((column) => column.name === 'request_index')) {
      this.db.exec('alter table image_history add column request_index integer')
    }
    if (!columns.some((column) => column.name === 'file_size_bytes')) {
      this.db.exec('alter table image_history add column file_size_bytes integer')
    }
    if (!columns.some((column) => column.name === 'generation_mode')) {
      this.db.exec("alter table image_history add column generation_mode text not null default 'text-to-image'")
    }
    const runColumns = this.db.prepare('pragma table_info(generation_runs)').all() as Array<{ name: string }>
    if (!runColumns.some((column) => column.name === 'duration_ms')) {
      this.db.exec('alter table generation_runs add column duration_ms integer')
    }
    if (!runColumns.some((column) => column.name === 'generation_mode')) {
      this.db.exec("alter table generation_runs add column generation_mode text not null default 'text-to-image'")
    }

    // ===== 供应商 =====
    this.db.exec(`
      create table if not exists providers (
        id text primary key,
        name text not null,
        base_url text not null,
        api_key text,
        default_model text not null,
        prompt_model text,
        supports_mask integer not null default 1,
        supports_gif integer not null default 0,
        supports_svg integer not null default 0,
        capability_mask text not null default 'auto',
        capability_gif text not null default 'auto',
        capability_svg text not null default 'auto',
        pricing_mode text not null default 'unified',
        price_unified real,
        price_1k real,
        price_2k real,
        price_4k real,
        rate_text_input real,
        rate_image_input real,
        rate_image_output real,
        is_default integer not null default 0,
        position integer not null default 0,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists provider_models (
        provider_id text not null,
        model_id text not null,
        added integer not null default 1,
        position integer not null default 0,
        primary key (provider_id, model_id)
      );
    `)

    // 2.5 / 2.6 参数列
    const addColumn = (table: string, column: string, ddl: string) => {
      const cols = this.db.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>
      if (!cols.some((c) => c.name === column)) {
        this.db.exec(`alter table ${table} add column ${ddl}`)
      }
    }
    addColumn('conversations', 'complexity', 'complexity text')
    addColumn('conversations', 'frame_count', 'frame_count integer')
    addColumn('conversations', 'frame_duration_ms', 'frame_duration_ms integer')
    addColumn('conversations', 'seed', 'seed integer')
    addColumn('conversations', 'seed_locked', 'seed_locked integer not null default 0')
    addColumn('conversations', 'provider_id', 'provider_id text')
    addColumn('providers', 'capability_mask', "capability_mask text not null default 'auto'")
    addColumn('providers', 'capability_gif', "capability_gif text not null default 'auto'")
    addColumn('providers', 'capability_svg', "capability_svg text not null default 'auto'")
    addColumn('generation_runs', 'complexity', 'complexity text')
    addColumn('generation_runs', 'frame_count', 'frame_count integer')
    addColumn('generation_runs', 'frame_duration_ms', 'frame_duration_ms integer')
    addColumn('generation_runs', 'seed', 'seed integer')
    addColumn('generation_runs', 'provider_id', 'provider_id text')
    addColumn('image_history', 'complexity', 'complexity text')
    addColumn('image_history', 'seed', 'seed integer')
    addColumn('image_history', 'provider_id', 'provider_id text')
    addColumn('image_history', 'cost_estimate', 'cost_estimate real')
  }

  private conversationFromRow(row: Row): Conversation {
    return {
      id: String(row.id),
      title: String(row.title),
      draftPrompt: String(row.draft_prompt),
      model: String(row.model),
      ratio: row.ratio as ImageRatio,
      size: row.size ? String(row.size) : getDefaultImageSize(row.ratio as ImageRatio),
      quality: row.quality as Conversation['quality'],
      n: Number(row.n),
      outputFormat: row.output_format ? String(row.output_format) as Conversation['outputFormat'] : DEFAULT_IMAGE_OUTPUT_FORMAT,
      outputCompression: row.output_compression != null ? Number(row.output_compression) : null,
      background: row.background === 'opaque' ? 'opaque' : 'auto',
      moderation: row.moderation === 'low' ? 'low' : 'auto',
      stream: Boolean(row.stream),
      partialImages: row.partial_images != null ? Number(row.partial_images) : 0,
      inputFidelity: row.input_fidelity === 'high' || row.input_fidelity === 'low' ? row.input_fidelity : null,
      providerId: row.provider_id ? String(row.provider_id) : null,
      complexity: row.complexity === 'low' || row.complexity === 'medium' || row.complexity === 'high' ? row.complexity : null,
      frameCount: typeof row.frame_count === 'number' ? row.frame_count : null,
      frameDurationMs: typeof row.frame_duration_ms === 'number' ? row.frame_duration_ms : null,
      seed: typeof row.seed === 'number' ? row.seed : null,
      seedLocked: Boolean(row.seed_locked),
      autoSaveHistory: Boolean(row.auto_save_history),
      keepFailureDetails: Boolean(row.keep_failure_details),
      referenceImages: this.listConversationReferences(String(row.id)),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }
  }

  private runFromRow = (row: Row): GenerationRun => ({
    id: String(row.id),
    conversationId: String(row.conversation_id),
    prompt: String(row.prompt),
    model: String(row.model),
    ratio: row.ratio as ImageRatio,
    size: row.size ? String(row.size) : getDefaultImageSize(row.ratio as ImageRatio),
    quality: row.quality as GenerationRun['quality'],
    durationMs: row.duration_ms != null ? Number(row.duration_ms) : null,
    n: Number(row.n),
    status: row.status as GenerationRunStatus,
    errorMessage: row.error_message ? String(row.error_message) : null,
    errorDetails: row.error_details ? String(row.error_details) : null,
    generationMode: row.generation_mode === 'image-to-image' ? 'image-to-image' : 'text-to-image',
    referenceImages: this.listRunReferences(String(row.id)),
    createdAt: String(row.created_at),
    items: this.db
      .prepare(`
        select * from image_history
        where run_id = ?
        order by
          case when request_index is null then 1 else 0 end,
          request_index asc,
          created_at asc
      `)
      .all(String(row.id))
      .map((historyRow) => this.historyFromRow(historyRow as Row))
  })

  private recoverInterruptedRun(runId: string, now: Date): void {
    const run = this.getRun(runId)
    if (!run || run.status !== 'running') {
      return
    }

    const recoveryPlan = createInterruptedRunRecoveryPlan(run, now)
    if (recoveryPlan.failedItems.length > 0) {
      for (const failedItem of recoveryPlan.failedItems) {
        this.db
          .prepare(
            `insert into image_history
            (id, conversation_id, run_id, prompt, model, ratio, size, quality, request_index, duration_ms, file_path, file_size_bytes, status, error_message, error_details, favorite, global_visible, generation_mode, created_at)
            values (@id, @conversationId, @runId, @prompt, @model, @ratio, @size, @quality, @requestIndex, @durationMs, @filePath, @fileSizeBytes, @status, @errorMessage, @errorDetails, @favorite, @globalVisible, @generationMode, @createdAt)`
          )
          .run({
            id: randomUUID(),
            conversationId: run.conversationId,
            runId: run.id,
            prompt: run.prompt,
            model: run.model,
            ratio: run.ratio,
            size: run.size,
            quality: run.quality,
            requestIndex: failedItem.requestIndex,
            durationMs: failedItem.durationMs,
            filePath: null,
            fileSizeBytes: null,
            status: 'failed',
            errorMessage: failedItem.errorMessage,
            errorDetails: failedItem.errorDetails,
            favorite: 0,
            globalVisible: this.getConversation(run.conversationId)?.autoSaveHistory !== false ? 1 : 0,
            generationMode: run.generationMode,
            createdAt: failedItem.createdAt
          })
      }
    }

    this.updateRun(run.id, {
      status: recoveryPlan.status,
      errorMessage: recoveryPlan.errorMessage,
      errorDetails: recoveryPlan.errorDetails,
      durationMs: recoveryPlan.durationMs
    })
  }

  private historyFromRow = (row: Row): ImageHistoryItem => ({
    id: String(row.id),
    conversationId: row.conversation_id ? String(row.conversation_id) : null,
    runId: row.run_id ? String(row.run_id) : null,
    prompt: String(row.prompt),
    model: String(row.model),
    ratio: row.ratio as ImageRatio,
    size: row.size ? String(row.size) : null,
    quality: row.quality as ImageHistoryItem['quality'],
    requestIndex: row.request_index != null ? Number(row.request_index) : null,
    durationMs: row.duration_ms != null ? Number(row.duration_ms) : null,
    filePath: row.file_path ? String(row.file_path) : null,
    fileSizeBytes: row.file_size_bytes != null ? Number(row.file_size_bytes) : this.getImageFileSize(row.file_path),
    status: row.status as ImageStatus,
    errorMessage: row.error_message ? String(row.error_message) : null,
    errorDetails: row.error_details ? String(row.error_details) : null,
    favorite: Boolean(row.favorite),
    generationMode: row.generation_mode === 'image-to-image' ? 'image-to-image' : 'text-to-image',
    referenceImages: row.run_id ? this.listRunReferences(String(row.run_id)) : [],
    createdAt: String(row.created_at)
  })

  private insertReferenceImage(reference: ReferenceImage): ReferenceImage {
    this.db
      .prepare(
        `insert into reference_images
        (id, name, mime_type, file_path, file_size_bytes, created_at)
        values (@id, @name, @mimeType, @filePath, @fileSizeBytes, @createdAt)`
      )
      .run(reference)
    return reference
  }

  private attachReferenceToConversation(conversationId: string, referenceImageId: string, position: number): void {
    this.db
      .prepare(
        `insert or ignore into conversation_reference_images
        (conversation_id, reference_image_id, position, created_at)
        values (?, ?, ?, ?)`
      )
      .run(conversationId, referenceImageId, position, new Date().toISOString())
  }

  private compactConversationReferencePositions(conversationId: string): ReferenceImage[] {
    const references = this.listConversationReferences(conversationId)
    const updatePosition = this.db.prepare(
      'update conversation_reference_images set position = ? where conversation_id = ? and reference_image_id = ?'
    )
    const transaction = this.db.transaction(() => {
      references.forEach((reference, index) => updatePosition.run(index, conversationId, reference.id))
    })
    transaction()
    return this.listConversationReferences(conversationId)
  }

  private listRunReferences(runId: string): ReferenceImage[] {
    return this.db
      .prepare('select * from generation_run_references where run_id = ? order by position asc, created_at asc')
      .all(runId)
      .map((row) => this.runReferenceFromRow(row as Row))
  }

  private referenceFromRow(row: Row): ReferenceImage {
    return {
      id: String(row.id),
      name: String(row.name),
      mimeType: String(row.mime_type),
      filePath: row.file_path ? String(row.file_path) : null,
      fileSizeBytes: Number(row.file_size_bytes),
      createdAt: String(row.created_at)
    }
  }

  private runReferenceFromRow(row: Row): ReferenceImage {
    return {
      id: String(row.reference_image_id),
      name: String(row.name),
      mimeType: String(row.mime_type),
      filePath: row.file_path ? String(row.file_path) : null,
      fileSizeBytes: Number(row.file_size_bytes),
      createdAt: String(row.created_at)
    }
  }

  /** 注册用户配置的图片根目录（空/null = 清除）；供删除守卫识别自定义位置 */
  setExtraImageRoot(root: string | null): void {
    this.extraImageRoot = root && root.trim() ? resolve(root.trim()) : null
  }

  private deleteImageFile(filePath: string): void {
    const imagesRoot = resolve(this.imagesDir)
    const roots = [imagesRoot]
    if (this.extraImageRoot) roots.push(this.extraImageRoot)
    // 缩略图是原图的派生产物，必须随原图一起清理，否则每删一张图都会留下孤儿文件。
    for (const candidate of derivedImagePaths(filePath)) {
      const resolved = resolve(candidate)
      if (roots.some((root) => isPathInside(root, resolved)) && existsSync(resolved)) {
        unlinkSync(resolved)
      }
    }
  }

  private getImageFileSize(filePath: unknown): number | null {
    if (!filePath) return null
    try {
      const resolved = resolve(String(filePath))
      if (!existsSync(resolved)) return null
      const stat = statSync(resolved)
      return stat.isFile() ? stat.size : null
    } catch {
      return null
    }
  }

  // ===== 供应商 =====

  listProviders(): Provider[] {
    const rows = this.db.prepare('select * from providers order by position asc, created_at asc').all() as ProviderRow[]
    return rows.map((row) => this.providerFromRow(row))
  }

  createProvider(input: ProviderInput): Provider {
    const now = new Date().toISOString()
    const existing = this.listProviders()
    const provider: Provider = {
      id: randomUUID(),
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
    this.db
      .prepare(
        `insert into providers
        (id, name, base_url, api_key, default_model, prompt_model, supports_mask, supports_gif, supports_svg,
         capability_mask, capability_gif, capability_svg,
         pricing_mode, price_unified, price_1k, price_2k, price_4k, rate_text_input, rate_image_input,
         rate_image_output, is_default, position, created_at, updated_at)
        values (@id, @name, @baseURL, @apiKey, @defaultModel, @promptModel, @supportsMask, @supportsGif, @supportsSvg,
         @capabilityMask, @capabilityGif, @capabilitySvg,
         @pricingMode, @priceUnified, @price1K, @price2K, @price4K, @rateTextInput, @rateImageInput,
         @rateImageOutput, @isDefault, @position, @createdAt, @updatedAt)`
      )
      .run({
        ...provider,
        supportsMask: provider.supportsMask ? 1 : 0,
        supportsGif: provider.supportsGif ? 1 : 0,
        supportsSvg: provider.supportsSvg ? 1 : 0,
        isDefault: provider.isDefault ? 1 : 0
      })
    if (provider.isDefault) this.setDefaultProvider(provider.id)
    return provider
  }

  updateProvider(id: string, input: ProviderInput): Provider {
    const current = this.getProvider(id)
    if (!current) throw new Error('Provider not found.')
    const next: Provider = {
      ...current,
      ...input,
      name: input.name?.trim() ?? current.name,
      baseURL: input.baseURL?.trim() ?? current.baseURL,
      defaultModel: input.defaultModel?.trim() ?? current.defaultModel,
      updatedAt: new Date().toISOString()
    }
    this.db
      .prepare(
        `update providers set
        name = @name, base_url = @baseURL, api_key = @apiKey, default_model = @defaultModel,
        prompt_model = @promptModel, supports_mask = @supportsMask, supports_gif = @supportsGif,
        supports_svg = @supportsSvg, capability_mask = @capabilityMask, capability_gif = @capabilityGif,
        capability_svg = @capabilitySvg, pricing_mode = @pricingMode, price_unified = @priceUnified,
        price_1k = @price1K, price_2k = @price2K, price_4k = @price4K, rate_text_input = @rateTextInput,
        rate_image_input = @rateImageInput, rate_image_output = @rateImageOutput, is_default = @isDefault,
        updated_at = @updatedAt
        where id = @id`
      )
      .run({
        ...next,
        supportsMask: next.supportsMask ? 1 : 0,
        supportsGif: next.supportsGif ? 1 : 0,
        supportsSvg: next.supportsSvg ? 1 : 0,
        isDefault: next.isDefault ? 1 : 0
      })
    if (next.isDefault) this.setDefaultProvider(next.id)
    return next
  }

  removeProvider(id: string): void {
    this.db.prepare('delete from provider_models where provider_id = ?').run(id)
    this.db.prepare('delete from providers where id = ?').run(id)
    this.db.prepare('update conversations set provider_id = null where provider_id = ?').run(id)
  }

  setDefaultProvider(id: string): Provider[] {
    this.db.prepare('update providers set is_default = 0').run()
    this.db.prepare('update providers set is_default = 1 where id = ?').run(id)
    return this.listProviders()
  }

  getProvider(id: string): Provider | null {
    const row = this.db.prepare('select * from providers where id = ?').get(id) as ProviderRow | undefined
    return row ? this.providerFromRow(row) : null
  }

  listProviderModels(providerId: string): ProviderModel[] {
    const rows = this.db
      .prepare('select * from provider_models where provider_id = ? order by position asc')
      .all(providerId) as Array<{ provider_id: string; model_id: string; added: number; position: number }>
    return rows.map((row) => ({
      providerId: row.provider_id,
      modelId: row.model_id,
      added: Boolean(row.added),
      position: row.position
    }))
  }

  saveProviderModels(providerId: string, modelIds: string[]): ProviderModel[] {
    this.db.prepare('delete from provider_models where provider_id = ?').run(providerId)
    const insert = this.db.prepare(
      'insert into provider_models (provider_id, model_id, added, position) values (?, ?, 1, ?)'
    )
    modelIds.forEach((modelId, index) => insert.run(providerId, modelId, index))
    return this.listProviderModels(providerId)
  }

  private providerFromRow(row: ProviderRow): Provider {
    return {
      id: String(row.id),
      name: String(row.name),
      baseURL: String(row.base_url),
      apiKey: row.api_key ? String(row.api_key) : null,
      defaultModel: String(row.default_model),
      promptModel: row.prompt_model ? String(row.prompt_model) : null,
      supportsMask: Boolean(row.supports_mask),
      supportsGif: Boolean(row.supports_gif),
      supportsSvg: Boolean(row.supports_svg),
      capabilityMask: normalizeCapabilityOverride(row.capability_mask),
      capabilityGif: normalizeCapabilityOverride(row.capability_gif),
      capabilitySvg: normalizeCapabilityOverride(row.capability_svg),
      pricingMode: (row.pricing_mode as Provider['pricingMode']) || 'unified',
      priceUnified: typeof row.price_unified === 'number' ? row.price_unified : null,
      price1K: typeof row.price_1k === 'number' ? row.price_1k : null,
      price2K: typeof row.price_2k === 'number' ? row.price_2k : null,
      price4K: typeof row.price_4k === 'number' ? row.price_4k : null,
      rateTextInput: typeof row.rate_text_input === 'number' ? row.rate_text_input : null,
      rateImageInput: typeof row.rate_image_input === 'number' ? row.rate_image_input : null,
      rateImageOutput: typeof row.rate_image_output === 'number' ? row.rate_image_output : null,
      isDefault: Boolean(row.is_default),
      position: typeof row.position === 'number' ? row.position : 0,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }
  }
}

type ProviderRow = {
  id: string
  name: string
  base_url: string
  api_key: string | null
  default_model: string
  prompt_model: string | null
  supports_mask: number
  supports_gif: number
  supports_svg: number
  capability_mask: string | null
  capability_gif: string | null
  capability_svg: string | null
  pricing_mode: string
  price_unified: number | null
  price_1k: number | null
  price_2k: number | null
  price_4k: number | null
  rate_text_input: number | null
  rate_image_input: number | null
  rate_image_output: number | null
  is_default: number
  position: number
  created_at: string
  updated_at: string
}

/** 存储层的三态覆盖值兜底：脏数据或旧值一律按 auto 处理 */
function normalizeReferenceMimeType(mimeType: string, name: string): string {
  const normalized = mimeType.toLowerCase()
  if (referenceMimeTypes.has(normalized)) return normalized === 'image/jpg' ? 'image/jpeg' : normalized
  const extension = extensionFromName(name)
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.png') return 'image/png'
  if (extension === '.webp') return 'image/webp'
  throw new Error('仅支持 PNG、JPG、WEBP 参考图。')
}

function extensionFromName(name: string): string | null {
  const extension = extname(name).toLowerCase()
  if (extension === '.jpeg') return '.jpg'
  if (extension === '.jpg' || extension === '.png' || extension === '.webp') return extension
  return null
}

function mimeTypeFromExtension(extension: string): string {
  const normalized = extension.toLowerCase()
  if (normalized === '.jpg' || normalized === '.jpeg') return 'image/jpeg'
  if (normalized === '.webp') return 'image/webp'
  return 'image/png'
}
