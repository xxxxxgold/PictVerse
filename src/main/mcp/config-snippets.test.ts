import { describe, expect, it } from 'vitest'
import { buildMcpSnippets } from './config-snippets'

const TOKEN = 'f'.repeat(64)
const STDIO = {
  command: 'C:\\Program Files\\PictVerse\\PictVerse.exe',
  args: ['C:\\Program Files\\PictVerse\\resources\\mcp\\pictverse-mcp.mjs'],
  env: { ELECTRON_RUN_AS_NODE: '1' }
}

describe('MCP 客户端配置片段', () => {
  it('带 stdio 时给出 5 份：stdio 两种 + HTTP 三种', () => {
    const snippets = buildMcpSnippets({ port: 27810, token: TOKEN, stdio: STDIO })
    expect(snippets.map((snippet) => snippet.id)).toEqual([
      'codex-stdio',
      'claude-stdio',
      'codex',
      'claude',
      'generic'
    ])
  })

  it('拿不到桥路径时只给 HTTP 三种，不留半截命令', () => {
    const snippets = buildMcpSnippets({ port: 27810, token: TOKEN, stdio: null })
    expect(snippets.map((snippet) => snippet.id)).toEqual(['codex', 'claude', 'generic'])
  })

  it('Codex HTTP 片段是合法 TOML 结构且带端口与 token', () => {
    const codex = buildMcpSnippets({ port: 27810, token: TOKEN }).find((s) => s.id === 'codex')
    expect(codex?.content).toContain('[mcp_servers.pictverse]')
    expect(codex?.content).toContain('type = "streamable-http"')
    expect(codex?.content).toContain('url = "http://127.0.0.1:27810/mcp"')
    expect(codex?.content).toContain(`Authorization = "Bearer ${TOKEN}"`)
  })

  it('Codex stdio 片段把 Windows 路径转义成双反斜杠', () => {
    const snippet = buildMcpSnippets({ port: 27810, token: TOKEN, stdio: STDIO }).find((s) => s.id === 'codex-stdio')
    expect(snippet?.content).toContain('command = "C:\\\\Program Files\\\\PictVerse\\\\PictVerse.exe"')
    expect(snippet?.content).toContain('[mcp_servers.pictverse.env]')
    expect(snippet?.content).toContain('PICTVERSE_MCP_TOKEN = "' + TOKEN + '"')
    expect(snippet?.content).toContain('PICTVERSE_MCP_URL = "http://127.0.0.1:27810/mcp"')
    // 单反斜杠会被 TOML 当成转义符，必须一个都不剩
    expect(snippet?.content).not.toMatch(/command = "C:\\Program/)
  })

  it('两个 JSON 片段可解析且结构正确', () => {
    const snippets = buildMcpSnippets({ port: 27810, token: TOKEN, stdio: STDIO })
    for (const id of ['claude', 'generic', 'claude-stdio'] as const) {
      const snippet = snippets.find((item) => item.id === id)
      expect(snippet, id).toBeDefined()
      const parsed = JSON.parse(snippet!.content) as { mcpServers: Record<string, Record<string, unknown>> }
      const server = parsed.mcpServers.pictverse
      expect(server, id).toBeDefined()
      if (id === 'claude-stdio') {
        expect(server.command).toBe(STDIO.command)
        expect(server.args).toEqual(STDIO.args)
        expect((server.env as Record<string, string>).PICTVERSE_MCP_TOKEN).toBe(TOKEN)
      } else {
        expect(server.url).toBe('http://127.0.0.1:27810/mcp')
        expect((server.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`)
      }
    }
  })

  it('端口变化时片段跟着变，不写死默认端口', () => {
    const custom = buildMcpSnippets({ port: 51234, token: 'x', stdio: STDIO })
    for (const snippet of custom) {
      expect(snippet.content).toContain('51234')
      expect(snippet.content).not.toContain('27810')
    }
  })
})
