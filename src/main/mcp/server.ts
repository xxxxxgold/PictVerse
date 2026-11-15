/**
 * 内置 MCP 服务（Streamable HTTP）。
 *
 * 为什么不用 Express：SDK 的 transport 只吃 Node 的 req/res，node:http 足够，
 * 少一层依赖、少一份攻击面。服务的生命周期完全跟着 app 走，退出即释放端口。
 *
 * 安全边界（两层，都不是权限分级）：
 *   1. 只绑 127.0.0.1，局域网访问不到；
 *   2. 所有 MCP 请求要 Bearer token，防本机浏览器里的页面通过 DNS rebinding 打进来。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { McpLogEntry, McpStatus } from '@shared/types'
import { appVersion } from '@shared/app-version'
import type { AppDatabase } from '../database'
import type { ImageService } from '../image-service'
import type { PromptService } from '../prompt-service'
import type { SettingsStore } from '../settings'
import { ensureThumbnail } from '../thumbnail-native'
import {
  buildMcpEndpoint,
  MCP_HOST,
  tokensMatch
} from './config'
import type { McpLogStore } from './log-store'
import { Semaphore } from './semaphore'
import { registerMcpTools } from './tools'

const MAX_BODY_BYTES = 4 * 1024 * 1024
const MAX_IMAGE_WIDTH = 2048
/** 端口被占用时依次尝试的偏移量；够覆盖常见的「保留段误伤」场景 */
const PORT_FALLBACKS = [1, 2, 3, 5, 8, 13, 21, 34, 55]

function listenOn(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.removeListener('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.removeListener('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, MCP_HOST)
  })
}

export type McpServerDeps = {
  database: AppDatabase
  imageService: ImageService
  promptService: PromptService
  settings: SettingsStore
  logStore: McpLogStore
  /** 协议层事件（initialize / tools/list）的日志回调 */
  logEvent: (entry: Omit<McpLogEntry, 'id' | 'at'>) => void
  onImageDeleted: (imageId: string) => void
}

type Session = {
  transport: StreamableHTTPServerTransport
  clientName: string | null
  createdAt: number
}

export class McpHttpServer {
  private httpServer: Server | null = null
  private readonly sessions = new Map<string, Session>()
  private readonly sockets = new Set<Socket>()
  private startedAt: number | null = null
  private lastError: string | null = null
  private runningPort: number | null = null
  private toolCount = 0
  private readonly semaphore = new Semaphore(4)

  constructor(private readonly deps: McpServerDeps) {
    // 构造时就登记一次工具，设置页在没有任何客户端接入时也能显示正确的工具数
    this.toolCount = registerMcpTools(new McpServer({ name: 'pictverse', version: appVersion }), this.toolDeps())
  }

  get running(): boolean {
    return this.httpServer !== null
  }

  get port(): number {
    return this.runningPort ?? this.deps.settings.getMcpSettings().port
  }

  async start(): Promise<McpStatus> {
    const settings = this.deps.settings.getMcpSettings()
    if (this.httpServer) {
      if (this.runningPort === settings.port) return this.status()
      await this.stop()
    }

    this.lastError = null
    const httpServer = createServer((req, res) => {
      void this.route(req, res)
    })
    httpServer.on('connection', (socket) => {
      this.sockets.add(socket)
      socket.on('close', () => this.sockets.delete(socket))
    })

    // 端口被占用时自动顺延几个候选：Windows 的保留段并不总是能被 netsh 完整列出，
    // 用户也不该因为一个「看起来没人用」的端口号就开不了服务。
    const candidates = [settings.port, ...PORT_FALLBACKS.map((offset) => settings.port + offset).filter((value) => value <= 65535)]
    let boundPort = 0
    for (const candidate of candidates) {
      try {
        await listenOn(httpServer, candidate)
        // 端口 0 交给系统分配：必须读回真实端口，否则生成出来的 URL 是 0
        const address = httpServer.address()
        boundPort = typeof address === 'object' && address ? address.port : candidate
        break
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        const last = candidate === candidates[candidates.length - 1]
        if (!last && (code === 'EADDRINUSE' || code === 'EACCES')) continue
        // 全部候选都失败：把可读原因留给设置页，同时抛出中断启动
        this.lastError = code === 'EADDRINUSE'
          ? `端口 ${candidate} 及后续候选都被占用，请在设置里换一个端口。`
          : code === 'EACCES'
            ? `没有权限监听端口 ${candidate}，请换一个 1024 以上的端口。`
            : error instanceof Error ? error.message : String(error)
        httpServer.close()
        throw new Error(this.lastError)
      }
    }

    if (boundPort !== settings.port && settings.port !== 0) {
      // 自动换端口后写回配置：否则设置页、配置片段和真实监听地址会不一致
      this.deps.settings.updateMcpSettings({ port: boundPort })
    }

    // 启动阶段的错误监听：后续 runtime error 只记录，不再抛到外面
    httpServer.on('error', (error) => {
      this.lastError = error instanceof Error ? error.message : String(error)
    })

    this.httpServer = httpServer
    this.runningPort = boundPort
    this.startedAt = Date.now()
    return this.status()
  }

  async stop(): Promise<McpStatus> {
    const server = this.httpServer
    this.httpServer = null
    this.runningPort = null
    this.startedAt = null
    this.sessions.clear()

    if (server) {
      // 先掐掉 keep-alive 连接，close 才能真正释放端口
      for (const socket of this.sockets) socket.destroy()
      this.sockets.clear()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    return this.status()
  }

  async restart(): Promise<McpStatus> {
    await this.stop()
    return this.start()
  }

  status(): McpStatus {
    const settings = this.deps.settings.getMcpSettings()
    const stats = this.deps.logStore.stats()
    return {
      enabled: settings.enabled,
      running: this.httpServer !== null,
      host: MCP_HOST,
      port: this.port,
      endpoint: buildMcpEndpoint(this.port),
      startedAt: this.startedAt ? new Date(this.startedAt).toISOString() : null,
      sessionCount: this.sessions.size,
      toolCount: this.toolCount,
      callCount: stats.callCount,
      errorCount: stats.errorCount,
      lastError: this.lastError
    }
  }

  private resolveClientName(sessionId?: string): string | null {
    if (!sessionId) return null
    return this.sessions.get(sessionId)?.clientName ?? null
  }

  private toolDeps() {
    return {
      database: this.deps.database,
      imageService: this.deps.imageService,
      promptService: this.deps.promptService,
      settings: this.deps.settings,
      semaphore: this.semaphore,
      getPort: () => this.port,
      resolveClientName: (sessionId?: string) => this.resolveClientName(sessionId),
      onImageDeleted: this.deps.onImageDeleted,
      log: (input: Parameters<McpLogStore['append']>[0]) => {
        this.deps.logStore.append(input)
      }
    }
  }

  private createMcpServer(): McpServer {
    const server = new McpServer({ name: 'pictverse', version: appVersion })
    this.toolCount = registerMcpTools(server, this.toolDeps())
    return server
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const port = this.port
    // 防 DNS rebinding：Host 必须是本机地址
    if (!isLoopbackHost(req.headers.host, port)) {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: 'Host not allowed.' }))
      return
    }

    const url = new URL(req.url || '/', `http://${MCP_HOST}:${port}`)

    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, name: 'pictverse', version: appVersion }))
      return
    }

    if (url.pathname.startsWith('/images/')) {
      await this.serveImage(req, res, url)
      return
    }

    if (url.pathname !== '/mcp') {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: 'Not Found' }))
      return
    }

    const settings = this.deps.settings.getMcpSettings()
    if (!this.authorize(req, url, settings.token)) {
      this.deps.logEvent({
        tool: 'auth',
        ok: false,
        durationMs: 0,
        clientName: null,
        summary: `${req.method} ${url.pathname}`,
        error: '401 token 无效或缺失'
      })
      res.writeHead(401, {
        'content-type': 'application/json; charset=utf-8',
        'www-authenticate': 'Bearer'
      })
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized.' }, id: null }))
      return
    }

    let body: unknown
    if (req.method === 'POST') {
      const parsed = await readJsonBody(req)
      if (!parsed.ok) {
        res.writeHead(parsed.status, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: parsed.error }, id: null }))
        return
      }
      body = parsed.value
    }

    const sessionId = headerValue(req.headers['mcp-session-id'])
    const existing = sessionId ? this.sessions.get(sessionId) : undefined

    if (existing) {
      this.trackProtocolEvent(body, existing.clientName)
      await existing.transport.handleRequest(req, res, body)
      return
    }

    if (sessionId) {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Session not found.' }, id: null }))
      return
    }

    if (!isInitializeRequest(body)) {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Session required.' }, id: null }))
      return
    }

    const clientName = extractClientName(body)
    const server = this.createMcpServer()
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        this.sessions.set(id, { transport, clientName, createdAt: Date.now() })
      }
    })
    transport.onclose = () => {
      if (transport.sessionId) this.sessions.delete(transport.sessionId)
    }
    await server.connect(transport)
    this.deps.logEvent({
      tool: 'initialize',
      ok: true,
      durationMs: 0,
      clientName,
      summary: clientName ? `client=${clientName}` : '',
      error: null
    })
    await transport.handleRequest(req, res, body)
  }

  private trackProtocolEvent(body: unknown, clientName: string | null): void {
    const method = Array.isArray(body) ? null : (body as { method?: string } | null)?.method
    if (method !== 'tools/list') return
    this.deps.logEvent({
      tool: 'tools/list',
      ok: true,
      durationMs: 0,
      clientName,
      summary: '列出工具',
      error: null
    })
  }

  private authorize(req: IncomingMessage, url: URL, token: string): boolean {
    const header = headerValue(req.headers.authorization)
    if (header && header.toLowerCase().startsWith('bearer ')) {
      return tokensMatch(token, header.slice(7).trim())
    }
    // 图片 URL 会直接发给 agent，允许用查询参数带 token，避免客户端不支持自定义头
    const queryToken = url.searchParams.get('token')
    if (queryToken) return tokensMatch(token, queryToken)
    return false
  }

  private async serveImage(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const settings = this.deps.settings.getMcpSettings()
    if (!this.authorize(req, url, settings.token)) {
      res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: 'Unauthorized.' }))
      return
    }
    const id = decodeURIComponent(url.pathname.replace(/^\/images\//, ''))
    if (!id) {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: 'Image id required.' }))
      return
    }
    const item = this.deps.database.getHistory(id)
    if (!item?.filePath || !existsSync(item.filePath)) {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: 'Image not found.' }))
      return
    }

    const width = parseWidth(url.searchParams.get('w'))
    let target = item.filePath
    if (width > 0) {
      try {
        target = ensureThumbnail(item.filePath) ?? item.filePath
      } catch {
        target = item.filePath
      }
    }

    try {
      const file = readFileSync(target)
      res.writeHead(200, {
        'content-type': mimeTypeForPath(target),
        'content-length': String(file.length),
        'cache-control': 'private, max-age=31536000, immutable'
      })
      res.end(req.method === 'HEAD' ? undefined : file)
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Read failed.' }))
    }
  }
}

function isLoopbackHost(host: string | undefined, port: number): boolean {
  if (!host) return false
  return host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

type BodyResult = { ok: true; value: unknown } | { ok: false; status: number; error: string }

function readJsonBody(req: IncomingMessage): Promise<BodyResult> {
  return new Promise((resolve) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        resolve({ ok: false, status: 413, error: '请求体过大。' })
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) {
        resolve({ ok: true, value: undefined })
        return
      }
      try {
        resolve({ ok: true, value: JSON.parse(raw) })
      } catch {
        resolve({ ok: false, status: 400, error: '请求体不是合法 JSON。' })
      }
    })
    req.on('error', () => resolve({ ok: false, status: 400, error: '读取请求体失败。' }))
  })
}

function isInitializeRequest(body: unknown): boolean {
  const method = Array.isArray(body) ? body[0]?.method : (body as { method?: string } | undefined)?.method
  return method === 'initialize'
}

function extractClientName(body: unknown): string | null {
  const params = (body as { params?: { clientInfo?: { name?: string; version?: string } } } | undefined)?.params
  const name = params?.clientInfo?.name
  const version = params?.clientInfo?.version
  if (!name) return null
  return version ? `${name} ${version}` : name
}

function parseWidth(raw: string | null): number {
  if (!raw) return 0
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.min(MAX_IMAGE_WIDTH, Math.round(value))
}

function mimeTypeForPath(filePath: string): string {
  const lowered = filePath.toLowerCase()
  if (lowered.endsWith('.jpg') || lowered.endsWith('.jpeg')) return 'image/jpeg'
  if (lowered.endsWith('.webp')) return 'image/webp'
  if (lowered.endsWith('.gif')) return 'image/gif'
  if (lowered.endsWith('.svg')) return 'image/svg+xml'
  return 'image/png'
}
