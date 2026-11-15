import { describe, expect, it } from 'vitest'
import { DEFAULT_BRIDGE_URL, isLoopbackHostname, resolveBridgeConfig } from './config'

describe('stdio 桥配置', () => {
  it('缺 token 时给出可操作的错误', () => {
    expect(() => resolveBridgeConfig({ PICTVERSE_MCP_URL: DEFAULT_BRIDGE_URL })).toThrow('PICTVERSE_MCP_TOKEN')
  })

  it('缺 URL 时回退到默认本机地址', () => {
    const config = resolveBridgeConfig({ PICTVERSE_MCP_TOKEN: 'abc' })
    expect(config.url).toBe(DEFAULT_BRIDGE_URL)
    expect(config.token).toBe('abc')
    expect(config.warning).toBeNull()
  })

  it('拒绝非法协议', () => {
    expect(() => resolveBridgeConfig({ PICTVERSE_MCP_TOKEN: 'abc', PICTVERSE_MCP_URL: 'ftp://127.0.0.1/mcp' }))
      .toThrow('http')
  })

  it('拒绝解析不了的地址', () => {
    expect(() => resolveBridgeConfig({ PICTVERSE_MCP_TOKEN: 'abc', PICTVERSE_MCP_URL: '不是地址' })).toThrow('合法地址')
  })

  it('非回环地址只给警告，不直接拒绝', () => {
    const config = resolveBridgeConfig({ PICTVERSE_MCP_TOKEN: 'abc', PICTVERSE_MCP_URL: 'http://10.0.0.5:27810/mcp' })
    expect(config.warning).toContain('10.0.0.5')
  })

  it('识别本机地址', () => {
    expect(isLoopbackHostname('127.0.0.1')).toBe(true)
    expect(isLoopbackHostname('localhost')).toBe(true)
    expect(isLoopbackHostname('::1')).toBe(true)
    expect(isLoopbackHostname('10.0.0.5')).toBe(false)
    expect(isLoopbackHostname('evil.example.com')).toBe(false)
  })
})
