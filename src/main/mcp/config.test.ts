import { describe, expect, it } from 'vitest'
import {
  buildImageUrl,
  buildMcpEndpoint,
  DEFAULT_MCP_PORT,
  generateMcpToken,
  isValidMcpPort,
  normalizeMcpSettings,
  tokensMatch
} from './config'

describe('MCP 配置', () => {
  it('缺段时回退到「关闭 + 默认端口」', () => {
    expect(normalizeMcpSettings(undefined)).toEqual({ enabled: false, port: DEFAULT_MCP_PORT, token: '' })
    expect(normalizeMcpSettings({})).toEqual({ enabled: false, port: DEFAULT_MCP_PORT, token: '' })
  })

  it('保留合法字段，修正非法端口', () => {
    expect(normalizeMcpSettings({ enabled: true, port: 50000, token: ' abc ' })).toEqual({
      enabled: true,
      port: 50000,
      token: 'abc'
    })
    // 端口落在系统保留区或越界时要回退，而不是把服务配置写成不可启动
    expect(normalizeMcpSettings({ port: 80 }).port).toBe(DEFAULT_MCP_PORT)
    expect(normalizeMcpSettings({ port: 70000 }).port).toBe(DEFAULT_MCP_PORT)
    expect(normalizeMcpSettings({ port: 47610.5 }).port).toBe(DEFAULT_MCP_PORT)
  })

  it('端口必须是 1024–65535 的整数', () => {
    expect(isValidMcpPort(1024)).toBe(true)
    expect(isValidMcpPort(65535)).toBe(true)
    expect(isValidMcpPort(1023)).toBe(false)
    expect(isValidMcpPort(65536)).toBe(false)
    expect(isValidMcpPort(Number.NaN)).toBe(false)
    expect(isValidMcpPort('47610')).toBe(false)
  })

  it('token 是 32 字节的 hex，每次生成都不同', () => {
    const first = generateMcpToken()
    const second = generateMcpToken()
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(second).toMatch(/^[0-9a-f]{64}$/)
    expect(first).not.toBe(second)
  })

  it('只接受完全一致的 token', () => {
    const token = 'a'.repeat(64)
    expect(tokensMatch(token, token)).toBe(true)
    expect(tokensMatch(token, `${'a'.repeat(63)}b`)).toBe(false)
    expect(tokensMatch(token, 'a'.repeat(63))).toBe(false)
    expect(tokensMatch(token, '')).toBe(false)
    expect(tokensMatch('', '')).toBe(false)
  })

  it('拼出本机端点与图片地址', () => {
    expect(buildMcpEndpoint(47610)).toBe('http://127.0.0.1:47610/mcp')
    expect(buildImageUrl(47610, 'abc')).toBe('http://127.0.0.1:47610/images/abc')
    expect(buildImageUrl(47610, 'abc', 512)).toBe('http://127.0.0.1:47610/images/abc?w=512')
  })
})
