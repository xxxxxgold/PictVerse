import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 参考图生命周期回归。
 *
 * 之前的实现：removeReferenceFromConversation 只删关联表、deleteConversation 不碰参考图，
 * 结果每删一次都会留下 reference_images 行与磁盘文件（单张最大 20MB），
 * 且协议层仍能 200 取到已「移除」的图。
 *
 * better-sqlite3 按 Electron ABI 编译，纯 Node 下加载会抛错 —— 此时如实跳过，
 * 由 `pnpm test:native` 真正覆盖。
 */
async function loadModules(): Promise<{
  AppDatabase: typeof import('./database')['AppDatabase']
} | null> {
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
    console.warn(`[reference-lifecycle] 跳过：原生模块不可用 —— ${reason.split('\n').slice(0, 2).join(' ')}`)
    return null
  }
}

const TINY_PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

describe('reference image lifecycle', () => {
  it('deletes the row and the file when a reference is removed from a conversation', async (ctx) => {
    const modules = await loadModules()
    if (!modules) return ctx.skip()
    const { AppDatabase } = modules

    const dir = mkdtempSync(join(tmpdir(), 'pictverse-ref-'))
    const app = new AppDatabase(dir)
    try {
      const conversation = app.createConversation()
      const reference = app.createReferenceImageFromBytes({
        conversationId: conversation.id,
        name: 'a.png',
        mimeType: 'image/png',
        data: TINY_PNG
      })
      expect(existsSync(reference.filePath!)).toBe(true)

      app.removeReferenceFromConversation(conversation.id, reference.id)

      expect(app.listConversationReferences(conversation.id)).toHaveLength(0)
      expect(app.getReferenceImage(reference.id)).toBe(null)
      expect(existsSync(reference.filePath!)).toBe(false)
    } finally {
      app.close()
    }
  })

  it('cleans up every reference of a deleted conversation', async (ctx) => {
    const modules = await loadModules()
    if (!modules) return ctx.skip()
    const { AppDatabase } = modules

    const dir = mkdtempSync(join(tmpdir(), 'pictverse-ref-'))
    const app = new AppDatabase(dir)
    try {
      const conversation = app.createConversation()
      const references = [1, 2, 3].map((index) =>
        app.createReferenceImageFromBytes({
          conversationId: conversation.id,
          name: `ref-${index}.png`,
          mimeType: 'image/png',
          data: TINY_PNG
        })
      )
      expect(references).toHaveLength(3)

      app.deleteConversation(conversation.id)

      expect(app.getConversation(conversation.id)).toBe(null)
      for (const reference of references) {
        expect(app.getReferenceImage(reference.id)).toBe(null)
        expect(existsSync(reference.filePath!)).toBe(false)
      }
    } finally {
      app.close()
    }
  })

  it('keeps a reference that is still attached to another conversation', async (ctx) => {
    const modules = await loadModules()
    if (!modules) return ctx.skip()
    const { AppDatabase } = modules

    const dir = mkdtempSync(join(tmpdir(), 'pictverse-ref-'))
    const app = new AppDatabase(dir)
    try {
      const first = app.createConversation()
      const second = app.createConversation()
      const reference = app.createReferenceImageFromBytes({
        conversationId: first.id,
        name: 'shared.png',
        mimeType: 'image/png',
        data: TINY_PNG
      })
      // 同一张参考图再挂到第二个会话
      app['attachReferenceToConversation'](second.id, reference.id, 0)

      app.removeReferenceFromConversation(first.id, reference.id)

      // 仍被第二个会话引用，行与文件都必须保留
      expect(app.getReferenceImage(reference.id)).not.toBe(null)
      expect(existsSync(reference.filePath!)).toBe(true)
      expect(app.listConversationReferences(second.id)).toHaveLength(1)
    } finally {
      app.close()
    }
  })
})
