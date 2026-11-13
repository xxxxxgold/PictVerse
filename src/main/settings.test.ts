import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { SettingsStore } from './settings'

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
      promptModel: 'gpt-5.4-mini'
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

function createStore(): SettingsStore {
  const dir = mkdtempSync(join(tmpdir(), 'pictverse-settings-test-'))
  return new SettingsStore(join(dir, 'settings.json'), join(dir, 'images'))
}

function readJsonConfig(store: SettingsStore): Record<string, unknown> {
  const raw = (store as unknown as { filePath: string }).filePath
  if (!existsSync(raw)) return {}
  return JSON.parse(readFileSync(raw, 'utf8')) as Record<string, unknown>
}
