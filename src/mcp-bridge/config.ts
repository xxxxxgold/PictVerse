/**
 * stdio 桥的配置解析（纯函数，可单测）。
 *
 * 桥本身不碰数据库、不碰密钥：它只是一个「把 stdio 上的 MCP 请求转发到本机 HTTP 端点」的
 * 代理。真正干活的是绘世主进程，token 也只是访问本机服务的凭据。
 */

export const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:27810/mcp'

export type BridgeConfig = {
  url: string
  token: string
  /** 非回环地址只警告不拒绝：用户可能通过端口转发访问 */
  warning: string | null
}

export function resolveBridgeConfig(env: Record<string, string | undefined>): BridgeConfig {
  const rawUrl = (env.PICTVERSE_MCP_URL || DEFAULT_BRIDGE_URL).trim()
  const token = (env.PICTVERSE_MCP_TOKEN || '').trim()

  if (!token) {
    throw new Error('缺少 PICTVERSE_MCP_TOKEN。请从「绘世 → 设置 → MCP 服务」复制完整配置，不要只拷命令。')
  }

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error(`PICTVERSE_MCP_URL 不是合法地址：${rawUrl}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`只支持 http / https 地址，收到：${parsed.protocol}`)
  }

  return {
    url: parsed.toString(),
    token,
    warning: isLoopbackHostname(parsed.hostname)
      ? null
      : `注意：正在连接非本机地址 ${parsed.hostname}，token 会以明文发往该主机。`
  }
}

export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase()
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]' || host === '0.0.0.0'
}
