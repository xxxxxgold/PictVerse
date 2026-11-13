import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 旧版 providers 表语义的建表语句（本次改动前）。
 * 用它建库再交给 AppDatabase，验证 addColumn 迁移对存量用户库是否安全。
 */
const LEGACY_PROVIDERS_DDL = `
  create table providers (
    id text primary key,
    name text not null,
    base_url text not null,
    api_key text,
    default_model text not null,
    prompt_model text,
    supports_mask integer not null default 1,
    supports_gif integer not null default 0,
    supports_svg integer not null default 0,
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
`

describe('capability migration', () => {
  it('adds the three override columns to a legacy database and keeps old rows readable', async (ctx) => {
    // better-sqlite3 是原生模块；本机按 Electron ABI 编译，纯 Node 下加载会抛错。
    // 这种环境限制下如实跳过，不伪造通过。
    // 注：该包是 CJS 导出，运行时需取 `.default`，而 TS 类型把整个模块视为构造函数，故此处做一次窄断言。
    let Database: typeof import('better-sqlite3')
    let AppDatabase: typeof import('./database')['AppDatabase']
    try {
      const [sqliteModule, databaseModule] = await Promise.all([
        import('better-sqlite3'),
        import('./database')
      ])
      Database = (sqliteModule as unknown as { default: typeof import('better-sqlite3') }).default
      AppDatabase = databaseModule.AppDatabase
      const probe = new Database(':memory:')
      probe.close()
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      console.warn(`[capability-migration] 跳过：原生模块不可用 —— ${reason.split('\n')[0]}`)
      ctx.skip()
      return
    }

    const dir = mkdtempSync(join(tmpdir(), 'pictverse-mig-'))
    try {
      const legacy = new Database(join(dir, 'pictverse.sqlite'))
      legacy.exec(LEGACY_PROVIDERS_DDL)
      legacy
        .prepare(
          `insert into providers (id, name, base_url, default_model, supports_mask, supports_gif, supports_svg,
            pricing_mode, is_default, position, created_at, updated_at)
           values ('p-old', 'luluai', 'https://luluai.win', 'gpt-image-2.6-flare', 1, 0, 0,
            'unified', 1, 0, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')`
        )
        .run()
      legacy.close()

      const app = new AppDatabase(dir)
      const [provider] = app.listProviders()
      app.close()

      const check = new Database(join(dir, 'pictverse.sqlite'))
      const columns = (check.prepare('pragma table_info(providers)').all() as Array<{ name: string }>).map(
        (column) => column.name
      )
      const row = check.prepare('select * from providers where id = ?').get('p-old') as Record<string, unknown>
      check.close()

      expect(columns).toContain('capability_mask')
      expect(columns).toContain('capability_gif')
      expect(columns).toContain('capability_svg')
      expect(row.capability_mask).toBe('auto')
      expect(row.capability_gif).toBe('auto')
      expect(row.capability_svg).toBe('auto')
      // 旧数据与原字段不受影响
      expect(provider).toMatchObject({
        id: 'p-old',
        name: 'luluai',
        defaultModel: 'gpt-image-2.6-flare',
        capabilityMask: 'auto',
        capabilityGif: 'auto',
        capabilitySvg: 'auto',
        supportsMask: true,
        supportsGif: false,
        supportsSvg: false
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
