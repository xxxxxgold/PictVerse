/**
 * MCP 配置的纯函数层：默认值、端口校验、token 生成。
 * 刻意不依赖 electron 与 node:fs，保证可在 node 环境直接单测。
 */
import { randomBytes } from 'node:crypto'
import type { McpSettings } from '@shared/types'

/**
 * 默认端口 27810：避开 Windows 保留段（本机 45xxx–47xxx、49703–50694 实测不可绑定），
 * 同时远离 3000 / 5173 / 8080 这些常见开发端口。
 */
export const DEFAULT_MCP_PORT = 27810
export const MCP_HOST = '127.0.0.1'
export const MCP_PATH = '/mcp'
/** token 长度：32 字节 → 64 位 hex */
export const MCP_TOKEN_BYTES = 32

export const DEFAULT_MCP_SETTINGS: McpSettings = {
  enabled: false,
  port: DEFAULT_MCP_PORT,
  token: ''
}

export function isValidMcpPort(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  if (!Number.isInteger(value)) return false
  return value >= 1024 && value <= 65535
}

export function generateMcpToken(): string {
  return randomBytes(MCP_TOKEN_BYTES).toString('hex')
}

/**
 * 把任意来源的设置对象收敛成合法配置。
 * token 为空时**不生成**（生成要落盘，属于副作用），由 SettingsStore 负责；
 * 这里只保证类型与端口合法，便于纯函数测试与响应式回退。
 */
export function normalizeMcpSettings(input: Partial<McpSettings> | null | undefined): McpSettings {
  const raw = input || {}
  return {
    enabled: raw.enabled === true,
    port: isValidMcpPort(raw.port) ? raw.port : DEFAULT_MCP_PORT,
    token: typeof raw.token === 'string' ? raw.token.trim() : ''
  }
}

export function buildMcpEndpoint(port: number): string {
  return `http://${MCP_HOST}:${port}${MCP_PATH}`
}

export function buildHealthEndpoint(port: number): string {
  return `http://${MCP_HOST}:${port}/healthz`
}

/** 图片访问地址：给 agent 取原图/缩略图用 */
export function buildImageUrl(port: number, imageId: string, width?: number): string {
  const base = `http://${MCP_HOST}:${port}/images/${encodeURIComponent(imageId)}`
  return width && width > 0 ? `${base}?w=${Math.round(width)}` : base
}

/**
 * 常量时间比较 token，避免用 === 泄露前缀信息。
 * 长度不同直接返回 false（timingSafeEqual 要求等长入参）。
 */
export function tokensMatch(expected: string, received: string): boolean {
  if (!expected || !received) return false
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(received, 'utf8')
  if (a.length !== b.length) return false
  // 逐字节常量时间比较，避免把 node:crypto 之外的依赖带进纯函数层
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i]
  return diff === 0
}
