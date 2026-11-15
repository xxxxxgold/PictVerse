import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { safeStorage } from 'electron'
import { DEFAULT_MODEL } from '@shared/image-options'
import { DEFAULT_PROMPT_MODEL } from '@shared/prompt-options'
import type { McpSettings, ProviderSettings, ProviderSettingsUpdate } from '@shared/types'
import { generateMcpToken, isValidMcpPort, normalizeMcpSettings } from './mcp/config'

type SettingsFile = {
  baseURL: string
  defaultModel: string
  promptModel: string
  encryptedApiKey?: string
  plainApiKey?: string
  insecureStorage?: boolean
  imagesRoot?: string
  mcp?: Partial<McpSettings>
}

const defaultSettings: SettingsFile = {
  baseURL: 'https://api.openai.com',
  defaultModel: DEFAULT_MODEL,
  promptModel: DEFAULT_PROMPT_MODEL,
  insecureStorage: false
}

export class SettingsStore {
  constructor(
    private readonly filePath: string,
    private readonly defaultImagesRoot: string
  ) {
    mkdirSync(dirname(filePath), { recursive: true })
  }

  getPublicSettings(): ProviderSettings {
    const settings = this.read()
    return {
      baseURL: settings.baseURL,
      defaultModel: settings.defaultModel,
      promptModel: settings.promptModel,
      apiKeyStored: Boolean(settings.encryptedApiKey || settings.plainApiKey),
      insecureStorage: Boolean(settings.insecureStorage),
      imagesRoot: settings.imagesRoot || '',
      imagesRootEffective: settings.imagesRoot || this.defaultImagesRoot
    }
  }

  getDefaultImagesRoot(): string {
    return this.defaultImagesRoot
  }

  getApiKey(): string | null {
    const settings = this.read()
    if (settings.encryptedApiKey && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(settings.encryptedApiKey, 'base64'))
    }
    return settings.plainApiKey || null
  }

  /**
   * 读取 MCP 配置。token 为空时首次读取即生成并落盘：
   * 让「打开开关 → 复制配置」这条路不需要用户手动填 token。
   */
  getMcpSettings(): McpSettings {
    const settings = this.read()
    const normalized = normalizeMcpSettings(settings.mcp)
    if (normalized.token) return normalized

    const token = generateMcpToken()
    this.write({ ...settings, mcp: { ...normalized, token } })
    return { ...normalized, token }
  }

  updateMcpSettings(patch: Partial<McpSettings>): McpSettings {
    const settings = this.read()
    const current = normalizeMcpSettings(settings.mcp)
    const next: McpSettings = {
      enabled: patch.enabled ?? current.enabled,
      // 端口非法时保留原值并抛错，避免把服务配置写成不可启动的状态
      port: current.port,
      token: patch.token?.trim() || current.token || generateMcpToken()
    }
    if (patch.port !== undefined) {
      if (!isValidMcpPort(patch.port)) {
        throw new Error('端口必须是 1024–65535 之间的整数。')
      }
      next.port = patch.port
    }
    this.write({ ...settings, mcp: next })
    return next
  }

  rotateMcpToken(): { settings: McpSettings; token: string } {
    const token = generateMcpToken()
    const next = this.updateMcpSettings({ token })
    return { settings: next, token }
  }

  update(input: ProviderSettingsUpdate): ProviderSettings {
    const current = this.read()
    const next: SettingsFile = {
      ...current,
      ...(input.baseURL !== undefined ? { baseURL: input.baseURL.trim().replace(/\/+$/, '') || defaultSettings.baseURL } : {}),
      ...(input.defaultModel !== undefined ? { defaultModel: input.defaultModel.trim() || DEFAULT_MODEL } : {}),
      ...(input.promptModel !== undefined ? { promptModel: input.promptModel.trim() || DEFAULT_PROMPT_MODEL } : {})
    }

    if (input.imagesRoot !== undefined) {
      const root = input.imagesRoot?.trim() || ''
      delete next.imagesRoot
      if (root) {
        if (!isAbsolute(root)) {
          throw new Error('图片存储位置必须是绝对路径。')
        }
        probeWritableDirectory(resolve(root))
        next.imagesRoot = resolve(root)
      }
    }

    if (input.apiKey !== undefined) {
      const key = input.apiKey?.trim() || ''
      delete next.encryptedApiKey
      delete next.plainApiKey
      next.insecureStorage = false
      if (key && safeStorage.isEncryptionAvailable()) {
        next.encryptedApiKey = safeStorage.encryptString(key).toString('base64')
      } else if (key) {
        next.plainApiKey = key
        next.insecureStorage = true
      }
    }

    this.write(next)
    return this.getPublicSettings()
  }

  private read(): SettingsFile {
    if (!existsSync(this.filePath)) return defaultSettings
    try {
      return { ...defaultSettings, ...JSON.parse(readFileSync(this.filePath, 'utf8')) }
    } catch {
      return defaultSettings
    }
  }

  private write(settings: SettingsFile): void {
    writeFileSync(this.filePath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  }
}

/** 目录可写性探针：建目录 → 写临时文件 → 删除；任一步失败都抛统一错误 */
function probeWritableDirectory(root: string): void {
  try {
    mkdirSync(root, { recursive: true })
    const probePath = join(root, `.pictverse-probe-${randomBytes(6).toString('hex')}.tmp`)
    writeFileSync(probePath, 'probe')
    rmSync(probePath, { force: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`目录不可写，未保存设置：${message}`)
  }
}
