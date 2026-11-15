import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 存量库清理回归。
 *
 * 旧版 deleteConversation / removeReferenceFromConversation 只删关联表，
 * 存量用户库里会留下悬空关联行、run 与没有任何引用的参考图行/文件。
 * cleanupOrphanedReferences 必须在启动时把这些收干净，且不能误删仍在使用的图。
 */
async function loadModules(): Promise<{ AppDatabase: typeof import('./database')['AppDatabase'] } | null> {
  try {
    const [sqliteModule, databaseModule] = await Promise.all([
      import('better-sqlite3'),
      import('./database')
    ])
    const Database = (sqliteModule as unknown as { default: typeof import('better-sqlite3') }).default
    const probe = new Database(':memory:')
    probe.close()
    return { AppDatabase: databaseModule.AppDatabase }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(`[orphan-cleanup] 跳过：原生模块不可用 —— ${reason.split('\n').slice(0, 2).join(' ')}`)
    return null
  }
}

const TINY_PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

describe('orphaned reference cleanup', () => {
  it('removes dangling attachment rows and unreferenced reference images', async (ctx) => {
    const modules = await loadModules()
    if (!modules) return ctx.skip()
    const { AppDatabase } = modules

    const dir = mkdtempSync(join(tmpdir(), 'pictverse-orphan-'))
    const app = new AppDatabase(dir)
    try {
      const keep = app.createConversation()
      const doomed = app.createConversation()
      const keptRef = app.createReferenceImageFromBytes({
        conversationId: keep.id,
        name: 'keep.png',
        mimeType: 'image/png',
        data: TINY_PNG
      })
      const orphanRef = app.createReferenceImageFromBytes({
        conversationId: doomed.id,
        name: 'orphan.png',
        mimeType: 'image/png',
        data: TINY_PNG
      })

      // 模拟旧版行为：只删会话行，留下关联行
      const raw = (app as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => unknown } } }).db
      raw.prepare('delete from conversations where id = ?').run(doomed.id)

      const result = app.cleanupOrphanedReferences()

      // 孤儿图被删，仍在使用的图保留
      expect(result.rows).toBeGreaterThanOrEqual(1)
      expect(app.getReferenceImage(orphanRef.id)).toBe(null)
      expect(existsSync(orphanRef.filePath!)).toBe(false)
      expect(app.getReferenceImage(keptRef.id)).not.toBe(null)
      expect(existsSync(keptRef.filePath!)).toBe(true)
      expect(app.listConversationReferences(keep.id)).toHaveLength(1)
    } finally {
      app.close()
    }
  })

  it('is a no-op on a healthy database', async (ctx) => {
    const modules = await loadModules()
    if (!modules) return ctx.skip()
    const { AppDatabase } = modules

    const dir = mkdtempSync(join(tmpdir(), 'pictverse-orphan-'))
    const app = new AppDatabase(dir)
    try {
      const conversation = app.createConversation()
      const reference = app.createReferenceImageFromBytes({
        conversationId: conversation.id,
        name: 'ok.png',
        mimeType: 'image/png',
        data: TINY_PNG
      })

      expect(app.cleanupOrphanedReferences()).toEqual({ rows: 0, files: 0 })
      expect(app.getReferenceImage(reference.id)).not.toBe(null)
      expect(existsSync(reference.filePath!)).toBe(true)
    } finally {
      app.close()
    }
  })
})
