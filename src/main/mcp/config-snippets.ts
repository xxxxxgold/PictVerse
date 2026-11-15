/**
 * 生成各 MCP 客户端的配置片段（纯函数，可单测）。
 * 内容里的端口、token、可执行文件路径都必须来自当前运行环境，不能写死。
 *
 * 提供两种接法：
 * - HTTP：客户端直接连本机 Streamable HTTP 端点，少一个进程；
 * - stdio：客户端拉起 pictverse-mcp.mjs 桥，由桥转发到 HTTP。只认 stdio 的客户端用这个。
 */
import type { McpConfigSnippet } from '@shared/types'
import { buildMcpEndpoint } from './config'

type SnippetInput = {
  port: number
  token: string
  /** stdio 桥的启动信息；拿不到时只输出 HTTP 片段 */
  stdio?: {
    command: string
    args: string[]
    env: Record<string, string>
  } | null
}

export function buildMcpSnippets(input: SnippetInput): McpConfigSnippet[] {
  const endpoint = buildMcpEndpoint(input.port)
  const authorization = `Bearer ${input.token}`
  const snippets: McpConfigSnippet[] = []

  if (input.stdio) {
    const stdioEnv = {
      ...input.stdio.env,
      PICTVERSE_MCP_URL: endpoint,
      PICTVERSE_MCP_TOKEN: input.token
    }
    snippets.push({
      id: 'codex-stdio',
      label: 'Codex CLI · stdio',
      hint: '追加到 ~/.codex/config.toml（兼容性最好）',
      language: 'toml',
      content: buildCodexStdio(input.stdio.command, input.stdio.args, stdioEnv)
    })
    snippets.push({
      id: 'claude-stdio',
      label: 'Claude Code · stdio',
      hint: '写入项目根目录 .mcp.json',
      language: 'json',
      content: `${JSON.stringify(buildClaudeStdio(input.stdio.command, input.stdio.args, stdioEnv), null, 2)}\n`
    })
  }

  snippets.push({
    id: 'codex',
    label: 'Codex CLI · HTTP',
    hint: '追加到 ~/.codex/config.toml',
    language: 'toml',
    content: [
      '[mcp_servers.pictverse]',
      'type = "streamable-http"',
      `url = "${endpoint}"`,
      `http_headers = { Authorization = "${authorization}" }`,
      'enabled = true',
      ''
    ].join('\n')
  })
  snippets.push({
    id: 'claude',
    label: 'Claude Code · HTTP',
    hint: '写入项目根目录 .mcp.json，或用 mcp add-json 导入',
    language: 'json',
    content: `${JSON.stringify(buildClaudeHttp(endpoint, authorization), null, 2)}\n`
  })
  snippets.push({
    id: 'generic',
    label: '通用 JSON · HTTP',
    hint: '支持 Streamable HTTP 的客户端均可使用',
    language: 'json',
    content: `${JSON.stringify(buildGenericHttp(endpoint, authorization), null, 2)}\n`
  })

  return snippets
}

function buildCodexStdio(command: string, args: string[], env: Record<string, string>): string {
  // TOML 基本字符串与 JSON 的转义规则兼容，Windows 路径必须用双反斜杠
  const argsText = args.map((arg) => JSON.stringify(arg)).join(', ')
  const envLines = Object.entries(env).map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
  return [
    '# 可执行文件与脚本路径按当前安装位置生成；移动软件后请重新复制',
    '[mcp_servers.pictverse]',
    `command = ${JSON.stringify(command)}`,
    `args = [${argsText}]`,
    'enabled = true',
    '',
    '[mcp_servers.pictverse.env]',
    ...envLines,
    ''
  ].join('\n')
}

function buildClaudeStdio(command: string, args: string[], env: Record<string, string>): Record<string, unknown> {
  return { mcpServers: { pictverse: { command, args, env } } }
}

function buildClaudeHttp(endpoint: string, authorization: string): Record<string, unknown> {
  return {
    mcpServers: {
      pictverse: {
        type: 'http',
        url: endpoint,
        headers: { Authorization: authorization }
      }
    }
  }
}

function buildGenericHttp(endpoint: string, authorization: string): Record<string, unknown> {
  return {
    mcpServers: {
      pictverse: {
        transport: 'streamable-http',
        url: endpoint,
        headers: { Authorization: authorization }
      }
    }
  }
}
