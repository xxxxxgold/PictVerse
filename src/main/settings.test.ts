import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { SettingsStore } from './settings'
import { DEFAULT_MCP_PORT } from './mcp/config'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString('utf8')
  }
}))

describe('settings store', () => {
  it('uses a separate default prompt assistant model', () => {
    const store = createStore()

    expect(store.getPublicSettings()).toMatchObject({
      defaultModel: 'gpt-image-2.6',
      promptModel: 'gpt-6.1-sol'
    })
  })

  it('updates prompt model without changing image model', () => {
    const store = createStore()

    const settings = store.update({ promptModel: 'gpt-5.4' })

    expect(settings.defaultModel).toBe('gpt-image-2.6')
    expect(settings.promptModel).toBe('gpt-5.4')
    expect(store.getPublicSettings().promptModel).toBe('gpt-5.4')
  })
})

describe('imagesRoot setting', () => {
  it('defaults to empty config and effective default root', () => {
    const store = createStore()

    const settings = store.getPublicSettings()
    expect(settings.imagesRoot).toBe('')
    expect(settings.imagesRootEffective).toBe(store.getDefaultImagesRoot())
  })

  it('accepts an absolute writable path and persists it', () => {
    const store = createStore()
    const root = mkdtempSync(join(tmpdir(), 'pictverse-images-root-'))

    const settings = store.update({ imagesRoot: root })

    expect(settings.imagesRoot).toBe(root)
    expect(settings.imagesRootEffective).toBe(root)
    expect(store.getPublicSettings().imagesRoot).toBe(root)
  })

  it('rejects relative paths without touching the config file', () => {
    const store = createStore()

    expect(() => store.update({ imagesRoot: 'relative/path' })).toThrow('绝对路径')

    expect(store.getPublicSettings().imagesRoot).toBe('')
    // 配置文件里没有 imagesRoot 字段
    expect(readJsonConfig(store).imagesRoot).toBeUndefined()
  })

  it('rejects unwritable directories without persisting', () => {
    const store = createStore()
    // 用一个已存在的文件路径冒充目录：mkdirSync 必然失败
    const dir = mkdtempSync(join(tmpdir(), 'pictverse-blocked-'))
    const blocked = join(dir, 'blocker')
    writeFileSync(blocked, 'not a directory')

    expect(() => store.update({ imagesRoot: blocked })).toThrow('不可写')
    expect(store.getPublicSettings().imagesRoot).toBe('')
    expect(readJsonConfig(store).imagesRoot).toBeUndefined()
  })

  it('reset to default by empty value', () => {
    const store = createStore()
    const root = mkdtempSync(join(tmpdir(), 'pictverse-images-root-'))
    store.update({ imagesRoot: root })

    const settings = store.update({ imagesRoot: '' })
    expect(settings.imagesRoot).toBe('')
    expect(settings.imagesRootEffective).toBe(store.getDefaultImagesRoot())
  })
})

describe('MCP 配置持久化', () => {
  it('配置文件缺 mcp 段时回退为「关闭 + 默认端口」', () => {
    const store = createStore()
    const mcp = store.getMcpSettings()

    expect(mcp.enabled).toBe(false)
    expect(mcp.port).toBe(DEFAULT_MCP_PORT)
  })

  it('首次读取即生成 32 字节 hex token 并落盘', () => {
    const store = createStore()
    const first = store.getMcpSettings()

    expect(first.token).toMatch(/^[0-9a-f]{64}$/)
    const persisted = readJsonConfig(store).mcp as { token?: string }
    expect(persisted.token).toBe(first.token)
    // 再次读取必须是同一个 token，不能每次换新
    expect(store.getMcpSettings().token).toBe(first.token)
  })

  it('轮换 token 后旧值失效并写入文件', () => {
    const store = createStore()
    const before = store.getMcpSettings().token
    const { token } = store.rotateMcpToken()

    expect(token).not.toBe(before)
    expect(store.getMcpSettings().token).toBe(token)
    expect((readJsonConfig(store).mcp as { token?: string }).token).toBe(token)
  })

  it('开关与端口可更新，非法端口被拒绝且不写坏配置', () => {
    const store = createStore()
    store.updateMcpSettings({ enabled: true, port: 51234 })

    expect(store.getMcpSettings()).toMatchObject({ enabled: true, port: 51234 })
    expect(() => store.updateMcpSettings({ port: 80 })).toThrow('1024')
    // 拒绝之后原值保持不变
    expect(store.getMcpSettings().port).toBe(51234)
  })
})

function createStore(): SettingsStore {
  const dir = mkdtempSync(join(tmpdir(), 'pictverse-settings-test-'))
  return new SettingsStore(join(dir, 'settings.json'), join(dir, 'images'))
}

function readJsonConfig(store: SettingsStore): Record<string, unknown> {
  const raw = (store as unknown as { filePath: string }).filePath
  if (!existsSync(raw)) return {}
  return JSON.parse(readFileSync(raw, 'utf8')) as Record<string, unknown>
}
