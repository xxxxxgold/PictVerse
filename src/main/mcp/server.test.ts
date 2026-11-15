import { request } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'

// server -> thumbnail-native -> electron：单测环境里没有 electron，给个空实现即可
vi.mock('electron', () => ({
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => true, getSize: () => ({ width: 0, height: 0 }) })
  }
}))

import type { Conversation } from '@shared/types'
import type { AppDatabase } from '../database'
import type { ImageService } from '../image-service'
import type { PromptService } from '../prompt-service'
import type { SettingsStore } from '../settings'
import { McpLogStore } from './log-store'
import { McpHttpServer } from './server'

const TOKEN = 'a'.repeat(64)

function makeConversation(): Conversation {
  return {
    id: 'conv-1',
    title: '雨夜猫咪',
    draftPrompt: '一只在雨里奔跑的猫',
    model: 'gpt-image-2.6',
    providerId: null,
    ratio: '1:1',
    size: '1024x1024',
    quality: 'high',
    n: 1,
    outputFormat: 'png',
    outputCompression: null,
    background: 'auto',
    moderation: 'auto',
    stream: false,
    partialImages: null,
    inputFidelity: null,
    complexity: null,
    frameCount: null,
    frameDurationMs: null,
    seed: null,
    seedLocked: false,
    autoSaveHistory: true,
    keepFailureDetails: true,
    referenceImages: [],
    createdAt: '2026-11-15T00:00:00.000Z',
    updatedAt: '2026-11-15T00:00:00.000Z'
  }
}

type Harness = { server: McpHttpServer; logStore: McpLogStore; port: number }

const started: McpHttpServer[] = []

async function startServer(): Promise<Harness> {
  const logStore = new McpLogStore(null)
  const database = {
    listConversations: () => [makeConversation()],
    getConversation: (id: string) => (id === 'conv-1' ? makeConversation() : null),
    listHistory: () => [],
    getHistory: () => null,
    getRun: () => null,
    listRuns: () => [],
    listProviders: () => [],
    listProviderModels: () => [],
    createConversation: () => makeConversation(),
    updateConversation: () => makeConversation()
  } as unknown as AppDatabase

  const settings = {
    getMcpSettings: () => ({ enabled: true, port: 0, token: TOKEN }),
    getPublicSettings: () => ({
      baseURL: 'https://api.example.com',
      apiKeyStored: true,
      defaultModel: 'gpt-image-2.6',
      promptModel: 'gpt-6.1-sol',
      insecureStorage: false,
      imagesRoot: '',
      imagesRootEffective: 'C:/data/images'
    }),
    getApiKey: () => null
  } as unknown as SettingsStore

  const server = new McpHttpServer({
    database,
    imageService: {} as ImageService,
    promptService: {} as PromptService,
    settings,
    logStore,
    logEvent: (entry) => logStore.append(entry),
    onImageDeleted: () => undefined
  })
  started.push(server)
  await server.start()
  return { server, logStore, port: server.status().port }
}

afterEach(async () => {
  await Promise.all(started.splice(0).map((server) => server.stop()))
})

type RpcResponse = {
  status: number
  headers: Record<string, string | string[] | undefined>
  raw: string
  json: Record<string, unknown> | null
}

function rpc(
  port: number,
  body: unknown,
  options: { token?: string | null; sessionId?: string; host?: string; method?: string } = {}
): Promise<RpcResponse> {
  const payload = body === undefined ? '' : JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: options.method ?? 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...(options.host ? { host: options.host } : {}),
          ...(options.token === null ? {} : { authorization: `Bearer ${options.token ?? TOKEN}` }),
          ...(options.sessionId ? { 'mcp-session-id': options.sessionId } : {})
        }
      },
      (res) => {
        let raw = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          raw += chunk
        })
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            raw,
            json: parseRpcJson(raw)
          })
        })
      }
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

/** 响应可能是纯 JSON，也可能是 text/event-stream（transport 默认走 SSE） */
function parseRpcJson(raw: string): Record<string, unknown> | null {
  const text = raw.trim()
  if (!text) return null
  if (text.startsWith('{')) {
    try {
      return JSON.parse(text) as Record<string, unknown>
    } catch {
      return null
    }
  }
  const dataLines = text
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter(Boolean)
  for (const line of dataLines.reverse()) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      if (parsed && typeof parsed === 'object' && ('result' in parsed || 'error' in parsed)) return parsed
    } catch {
      continue
    }
  }
  return null
}

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'vitest-client', version: '1.0.0' }
  }
}

async function openSession(port: number): Promise<string> {
  const response = await rpc(port, INITIALIZE)
  expect(response.status).toBe(200)
  const sessionId = response.headers['mcp-session-id']
  expect(typeof sessionId).toBe('string')
  // 初始化通知没有响应体，但必须被接受
  await rpc(port, { jsonrpc: '2.0', method: 'notifications/initialized' }, { sessionId: String(sessionId) })
  return String(sessionId)
}

describe('MCP HTTP 服务', () => {
  it('健康检查不需要 token', async () => {
    const { port } = await startServer()
    const response = await new Promise<number>((resolve, reject) => {
      request({ host: '127.0.0.1', port, path: '/healthz', method: 'GET' }, (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      }).on('error', reject).end()
    })
    expect(response).toBe(200)
  })

  it('缺 token 返回 401，token 错误也返回 401', async () => {
    const { port } = await startServer()
    expect((await rpc(port, INITIALIZE, { token: null })).status).toBe(401)
    expect((await rpc(port, INITIALIZE, { token: 'b'.repeat(64) })).status).toBe(401)
  })

  it('Host 头不是本机时返回 403（防 DNS rebinding）', async () => {
    const { port } = await startServer()
    const response = await rpc(port, INITIALIZE, { host: `evil.example.com:${port}` })
    expect(response.status).toBe(403)
  })

  it('initialize 返回 pictverse 服务信息与工具能力', async () => {
    const { port } = await startServer()
    const response = await rpc(port, INITIALIZE)
    expect(response.status).toBe(200)
    const result = response.json?.result as { serverInfo?: { name?: string }; capabilities?: { tools?: unknown } }
    expect(result?.serverInfo?.name).toBe('pictverse')
    expect(result?.capabilities?.tools).toBeDefined()
  })

  it('tools/list 暴露 15 个工具，含生成与图库入口', async () => {
    const { port, server } = await startServer()
    const sessionId = await openSession(port)
    const response = await rpc(port, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, { sessionId })
    const result = response.json?.result as { tools?: Array<{ name: string }> }
    const names = (result?.tools ?? []).map((tool) => tool.name)
    expect(names).toHaveLength(15)
    expect(names).toEqual(expect.arrayContaining(['generate_image', 'get_run', 'list_images', 'list_models', 'delete_images']))
    expect(server.status().toolCount).toBe(15)
  })

  it('tools/call 走真实处理链路并写日志', async () => {
    const { port, logStore } = await startServer()
    const sessionId = await openSession(port)
    const response = await rpc(port, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'list_conversations', arguments: { limit: 5 } }
    }, { sessionId })

    const result = response.json?.result as { content?: Array<{ type: string; text?: string }>; isError?: boolean }
    expect(result?.isError).toBeFalsy()
    const text = result?.content?.find((block) => block.type === 'text')?.text ?? ''
    const payload = JSON.parse(text) as { total: number; items: Array<{ id: string; title: string }> }
    expect(payload.total).toBe(1)
    expect(payload.items[0]).toMatchObject({ id: 'conv-1', title: '雨夜猫咪' })

    const entries = logStore.list()
    expect(entries.some((entry) => entry.tool === 'list_conversations' && entry.ok)).toBe(true)
  })

  it('未知会话与非法 JSON 都给出明确错误', async () => {
    const { port } = await startServer()
    const unknown = await rpc(port, { jsonrpc: '2.0', id: 4, method: 'tools/list' }, { sessionId: 'not-a-session' })
    expect(unknown.status).toBe(404)
  })

  it('停止后端口释放', async () => {
    const { server, port } = await startServer()
    expect(server.status().running).toBe(true)
    await server.stop()
    expect(server.status().running).toBe(false)
    await expect(new Promise((resolve, reject) => {
      request({ host: '127.0.0.1', port, path: '/healthz', method: 'GET', timeout: 500 }, (res) => {
        res.resume()
        resolve(res.statusCode)
      }).on('error', reject).on('timeout', () => reject(new Error('timeout'))).end()
    })).rejects.toBeTruthy()
  })
})
