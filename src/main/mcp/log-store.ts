/**
 * MCP 调用日志：内存环形缓冲 + 追加写 ndjson。
 *
 * 设计取舍：
 * - 日志是审计与排障用途，**绝不能**因为写盘失败而影响工具调用本身，所有 IO 都吞错。
 * - 内存里保留最近 MAX_ENTRIES 条，设置页只读内存；文件用于跨重启追溯。
 * - 文件超限时按「保留最后一批」重写，避免无限膨胀。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { McpLogEntry, McpLogPage } from '@shared/types'

export const MAX_LOG_ENTRIES = 500
export const MAX_LOG_FILE_BYTES = 1024 * 1024
/** 摘要截断长度：够看清入参，又不会把整段提示词写进日志 */
export const MAX_SUMMARY_LENGTH = 160
/** 设置页默认每页条数 */
export const DEFAULT_LOG_PAGE_SIZE = 20
export const MAX_ERROR_LENGTH = 200

export type McpLogInput = {
  tool: string
  ok: boolean
  durationMs: number
  clientName?: string | null
  summary?: string
  error?: string | null
}

export class McpLogStore {
  private entries: McpLogEntry[] = []
  private callCount = 0
  private errorCount = 0

  constructor(private readonly filePath: string | null) {
    this.load()
  }

  append(input: McpLogInput): McpLogEntry {
    const entry: McpLogEntry = {
      id: randomUUID(),
      at: new Date().toISOString(),
      tool: truncate(input.tool, 80),
      ok: input.ok,
      durationMs: Math.max(0, Math.round(input.durationMs)),
      clientName: input.clientName ? truncate(input.clientName, 60) : null,
      summary: truncate(input.summary ?? '', MAX_SUMMARY_LENGTH),
      error: input.error ? truncate(input.error, MAX_ERROR_LENGTH) : null
    }

    this.callCount += 1
    if (!entry.ok) this.errorCount += 1

    this.entries.push(entry)
    if (this.entries.length > MAX_LOG_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_LOG_ENTRIES)
    }
    this.persist(entry)
    return entry
  }

  list(options: { limit?: number; onlyErrors?: boolean } = {}): McpLogEntry[] {
    const filtered = options.onlyErrors ? this.entries.filter((entry) => !entry.ok) : this.entries
    const limit = options.limit && options.limit > 0 ? Math.min(options.limit, MAX_LOG_ENTRIES) : MAX_LOG_ENTRIES
    // 设置页要「最新的在最上面」，所以倒序返回
    return filtered.slice(-limit).reverse()
  }

  /**
   * 分页读取。page 从 1 开始，越界时收敛到最后一页（删日志后停在末页不会空白）。
   */
  listPage(options: { page?: number; pageSize?: number; onlyErrors?: boolean } = {}): McpLogPage {
    const filtered = (options.onlyErrors ? this.entries.filter((entry) => !entry.ok) : this.entries).slice().reverse()
    const pageSize = clampInt(options.pageSize ?? DEFAULT_LOG_PAGE_SIZE, 1, MAX_LOG_ENTRIES)
    const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
    const page = clampInt(options.page ?? 1, 1, pageCount)
    const start = (page - 1) * pageSize
    return {
      items: filtered.slice(start, start + pageSize),
      total: filtered.length,
      page,
      pageSize,
      pageCount
    }
  }

  clear(): void {
    this.entries = []
    if (!this.filePath) return
    try {
      writeFileSync(this.filePath, '', 'utf8')
    } catch {
      // 清空失败不影响内存视图，下一次写盘会覆盖
    }
  }

  stats(): { callCount: number; errorCount: number } {
    return { callCount: this.callCount, errorCount: this.errorCount }
  }

  private load(): void {
    if (!this.filePath || !existsSync(this.filePath)) return
    let raw = ''
    try {
      raw = readFileSync(this.filePath, 'utf8')
    } catch {
      return
    }
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      // 单行损坏（半截写入 / 手工改动）只跳过该行，不整体失败
      try {
        const parsed = JSON.parse(trimmed) as Partial<McpLogEntry>
        if (typeof parsed?.at !== 'string' || typeof parsed?.tool !== 'string') continue
        this.entries.push({
          id: typeof parsed.id === 'string' ? parsed.id : randomUUID(),
          at: parsed.at,
          tool: parsed.tool,
          ok: parsed.ok !== false,
          durationMs: typeof parsed.durationMs === 'number' ? parsed.durationMs : 0,
          clientName: typeof parsed.clientName === 'string' ? parsed.clientName : null,
          summary: typeof parsed.summary === 'string' ? parsed.summary : '',
          error: typeof parsed.error === 'string' ? parsed.error : null
        })
      } catch {
        continue
      }
    }
    if (this.entries.length > MAX_LOG_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_LOG_ENTRIES)
    }
  }

  private persist(entry: McpLogEntry): void {
    if (!this.filePath) return
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      this.rotateIfNeeded()
      appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, 'utf8')
    } catch {
      // 日志写失败绝不影响调用结果
    }
  }

  private rotateIfNeeded(): void {
    if (!this.filePath || !existsSync(this.filePath)) return
    let size = 0
    try {
      size = statSync(this.filePath).size
    } catch {
      return
    }
    if (size <= MAX_LOG_FILE_BYTES) return
    try {
      // 保留内存里的最新一批即可，文件不作长期归档
      const keep = this.entries.slice(-MAX_LOG_ENTRIES).map((entry) => JSON.stringify(entry))
      writeFileSync(this.filePath, keep.length ? `${keep.join('\n')}\n` : '', 'utf8')
    } catch {
      // 轮转失败就让它继续长，不阻断写入
    }
  }
}

function clampInt(value: number, min: number, max: number): number {
  const parsed = Number.isFinite(value) ? Math.trunc(value) : min
  return Math.min(max, Math.max(min, parsed))
}

/** 供「重置」等场景用：把旧文件挪成 .bak，保留最近一次的现场 */
export function archiveLogFile(filePath: string): void {
  if (!existsSync(filePath)) return
  try {
    renameSync(filePath, `${filePath}.bak`)
  } catch {
    // 忽略：拿不到归档也不影响新文件创建
  }
}

export function truncate(value: string, max: number): string {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}
