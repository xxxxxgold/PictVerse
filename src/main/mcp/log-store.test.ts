import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAX_LOG_ENTRIES, McpLogStore, truncate } from './log-store'

function tempLogPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pictverse-mcp-log-'))
  return join(dir, 'mcp.ndjson')
}

describe('MCP 日志', () => {
  it('记录调用并倒序返回（最新在最上面）', () => {
    const store = new McpLogStore(null)
    store.append({ tool: 'list_images', ok: true, durationMs: 12, summary: 'limit=5' })
    store.append({ tool: 'generate_image', ok: false, durationMs: 900, error: '端口被占用' })

    const entries = store.list()
    expect(entries).toHaveLength(2)
    expect(entries[0].tool).toBe('generate_image')
    expect(entries[0].ok).toBe(false)
    expect(entries[0].error).toBe('端口被占用')
    expect(entries[1].tool).toBe('list_images')
  })

  it('只过滤失败项时保留错误，不丢成功计数', () => {
    const store = new McpLogStore(null)
    store.append({ tool: 'a', ok: true, durationMs: 1 })
    store.append({ tool: 'b', ok: false, durationMs: 2, error: 'boom' })

    expect(store.list({ onlyErrors: true })).toHaveLength(1)
    expect(store.stats()).toEqual({ callCount: 2, errorCount: 1 })
  })

  it('超过上限时丢弃最旧记录', () => {
    const store = new McpLogStore(null)
    for (let index = 0; index < MAX_LOG_ENTRIES + 10; index += 1) {
      store.append({ tool: `tool-${index}`, ok: true, durationMs: index })
    }
    const entries = store.list({ limit: MAX_LOG_ENTRIES })
    expect(entries).toHaveLength(MAX_LOG_ENTRIES)
    expect(entries[0].tool).toBe(`tool-${MAX_LOG_ENTRIES + 9}`)
    expect(entries.at(-1)?.tool).toBe('tool-10')
  })

  it('落盘后新实例能读回，坏行被跳过', () => {
    const filePath = tempLogPath()
    const store = new McpLogStore(filePath)
    store.append({ tool: 'list_conversations', ok: true, durationMs: 3, summary: 'limit=20' })

    // 手工插入半截 JSON：断电/并发写入的真实形态
    writeFileSync(filePath, `${readFileSync(filePath, 'utf8')}{"tool":"broken"\n`, 'utf8')

    const reloaded = new McpLogStore(filePath)
    const entries = reloaded.list()
    expect(entries).toHaveLength(1)
    expect(entries[0].tool).toBe('list_conversations')
  })

  it('清空后内存与文件都为空', () => {
    const filePath = tempLogPath()
    const store = new McpLogStore(filePath)
    store.append({ tool: 'a', ok: true, durationMs: 1 })
    store.clear()

    expect(store.list()).toEqual([])
    expect(readFileSync(filePath, 'utf8')).toBe('')
  })

  it('摘要压缩空白并截断', () => {
    expect(truncate('  a\n\n b  ', 20)).toBe('a b')
    expect(truncate('x'.repeat(50), 10)).toHaveLength(10)
    expect(truncate('x'.repeat(50), 10).endsWith('…')).toBe(true)
  })
})

describe('日志分页', () => {
  function seed(count: number): McpLogStore {
    const store = new McpLogStore(null)
    for (let index = 0; index < count; index += 1) {
      store.append({ tool: `tool-${index}`, ok: index % 5 !== 0, durationMs: index })
    }
    return store
  }

  it('按页返回，最新的在第一页第一条', () => {
    const store = seed(45)
    const first = store.listPage({ page: 1, pageSize: 20 })
    expect(first.total).toBe(45)
    expect(first.pageCount).toBe(3)
    expect(first.items).toHaveLength(20)
    expect(first.items[0].tool).toBe('tool-44')

    const third = store.listPage({ page: 3, pageSize: 20 })
    expect(third.items).toHaveLength(5)
    expect(third.items.at(-1)?.tool).toBe('tool-0')
  })

  it('页边界与页大小都被收敛，不抛错也不返回空页', () => {
    const store = seed(5)
    expect(store.listPage({ page: 99, pageSize: 2 }).page).toBe(3)
    expect(store.listPage({ page: 0, pageSize: 2 }).page).toBe(1)
    expect(store.listPage({ page: 1, pageSize: 0 }).pageSize).toBe(1)
    expect(store.listPage({ page: 1, pageSize: 9999 }).pageSize).toBe(500)
  })

  it('只看失败时总数与分页都基于过滤后的集合', () => {
    const store = seed(10) // index 0/5 为失败 → 2 条
    const page = store.listPage({ page: 1, pageSize: 20, onlyErrors: true })
    expect(page.total).toBe(2)
    expect(page.pageCount).toBe(1)
    expect(page.items.every((entry) => !entry.ok)).toBe(true)
  })

  it('空日志返回一页空结果，page 仍为 1', () => {
    const store = new McpLogStore(null)
    const page = store.listPage({ page: 3 })
    expect(page).toMatchObject({ total: 0, page: 1, pageCount: 1, items: [] })
  })
})
