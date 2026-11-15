/**
 * PictVerse MCP stdio 桥。
 *
 * 为什么需要它：不少客户端（Claude Code、Codex 的部分版本、DSH）只支持通过 stdio 启动
 * MCP 服务，而绘世的能力全在 Electron 主进程里（safeStorage 密钥 + Electron ABI 的
 * better-sqlite3），不可能被一个独立进程直接调用。
 *
 * 所以这里只做一件事：把 stdio 上的 MCP 请求原样转发给本机 HTTP 端点。
 * - 不重复定义工具 schema：tools/list 直接取上游结果，加工具只改主进程；
 * - 不落任何状态：断线重连即可；
 * - 绝不往 stdout 写日志（那会破坏 JSON-RPC 流），出错一律走 stderr。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { appVersion } from '../shared/app-version'
import { resolveBridgeConfig } from './config'

const CONNECT_TIMEOUT_MS = 8000

async function main(): Promise<void> {
  const config = resolveBridgeConfig(process.env)
  if (config.warning) process.stderr.write(`[pictverse-mcp] ${config.warning}\n`)

  const client = new Client({ name: 'pictverse-bridge', version: appVersion }, { capabilities: {} })
  const clientTransport = new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: { headers: { Authorization: `Bearer ${config.token}` } }
  })

  try {
    await withTimeout(client.connect(clientTransport), CONNECT_TIMEOUT_MS)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    process.stderr.write(
      `[pictverse-mcp] 连不上绘世 MCP 服务（${config.url}）：${reason}\n` +
      '[pictverse-mcp] 请确认绘世已启动，且「设置 → MCP 服务」里的开关是打开的。\n'
    )
    process.exit(1)
  }

  const server = new Server(
    { name: 'pictverse', version: appVersion },
    { capabilities: { tools: {} } }
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const result = await client.listTools()
    return { tools: result.tools }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await client.callTool({
      name: request.params.name,
      arguments: request.params.arguments ?? {}
    })
    // 上游的 content / isError 原样透传，保证图片、resource_link 等块不被改写
    return result as { content: Array<{ type: string }>; isError?: boolean }
  })

  await server.connect(new StdioServerTransport())

  const shutdown = () => {
    void client.close().catch(() => undefined)
    process.exit(0)
  }
  process.stdin.on('end', shutdown)
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`连接超时（${ms / 1000}s）`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

main().catch((error: unknown) => {
  process.stderr.write(`[pictverse-mcp] 启动失败：${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
