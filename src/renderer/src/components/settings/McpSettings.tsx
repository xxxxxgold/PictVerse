import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Plug,
  RefreshCw,
  RotateCcw,
  Trash2
} from 'lucide-react'
import { formatDuration } from '@shared/duration'
import type { McpConfigSnippet, McpLogEntry, McpLogPage, McpStatus } from '@shared/types'

const POLL_INTERVAL_MS = 2000
const LOG_PAGE_SIZE = 20

/**
 * 设置里的 MCP 面板。
 *
 * 这里刻意不经过 store：MCP 状态是「服务的运行时快照」，放进全局 store 只会让
 * 每次轮询都触发整棵树重渲染。组件自己持有、只在面板可见时轮询。
 */
export function McpSettings(): JSX.Element {
  const api = window.pictverse.mcp
  const [status, setStatus] = useState<McpStatus | null>(null)
  const [logPage, setLogPage] = useState<McpLogPage | null>(null)
  const [page, setPage] = useState(1)
  const [token, setToken] = useState('')
  const [snippets, setSnippets] = useState<McpConfigSnippet[]>([])
  const [showToken, setShowToken] = useState(false)
  const [onlyErrors, setOnlyErrors] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [portDraft, setPortDraft] = useState('')
  const [portError, setPortError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [confirmingRotate, setConfirmingRotate] = useState(false)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const copyTimer = useRef<number | null>(null)

  const refresh = useCallback(async (withErrors: boolean, targetPage: number) => {
    if (!api) return
    try {
      const [nextStatus, nextLogs] = await Promise.all([
        api.status(),
        api.logs({ page: targetPage, pageSize: LOG_PAGE_SIZE, onlyErrors: withErrors })
      ])
      setStatus(nextStatus)
      setLogPage(nextLogs)
      // 清空或筛掉后可能停在超范围页，服务端会收敛，这里同步回来
      if (nextLogs.page !== targetPage) setPage(nextLogs.page)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取 MCP 状态')
    }
  }, [api])

  const loadStatic = useCallback(async () => {
    if (!api) return
    try {
      const [nextToken, nextSnippets] = await Promise.all([api.revealToken(), api.snippets()])
      setToken(nextToken)
      setSnippets(nextSnippets)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取 MCP 配置')
    }
  }, [api])

  useEffect(() => {
    if (!api) return
    void loadStatic()
    void refresh(onlyErrors, page)
    const timer = window.setInterval(() => void refresh(onlyErrors, page), POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [api, onlyErrors, page, loadStatic, refresh])

  useEffect(() => {
    if (status) setPortDraft(String(status.port))
  }, [status?.port])

  useEffect(() => () => {
    if (copyTimer.current != null) window.clearTimeout(copyTimer.current)
  }, [])

  const flashCopied = (key: string) => {
    setCopiedKey(key)
    if (copyTimer.current != null) window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopiedKey(null), 1600)
  }

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      flashCopied(key)
    } catch {
      setError('复制失败：系统剪贴板不可用')
    }
  }

  const runAction = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    try {
      await action()
      await refresh(onlyErrors, page)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const toggleEnabled = () => runAction(async () => {
    if (!api) return
    await api.setEnabled(!status?.enabled)
    await loadStatic()
  })

  const savePort = () => {
    const parsed = Number(portDraft.trim())
    if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
      setPortError('端口必须是 1024–65535 之间的整数')
      return
    }
    setPortError(null)
    void runAction(async () => {
      if (!api) return
      await api.setPort(parsed)
      await loadStatic()
    })
  }

  const rotateToken = () => {
    void runAction(async () => {
      if (!api) return
      const result = await api.rotateToken()
      setToken(result.token)
      setConfirmingRotate(false)
      await loadStatic()
    })
  }

  const clearLogs = () => {
    setConfirmingClear(false)
    void runAction(async () => {
      if (!api) return
      await api.clearLogs()
      setExpandedId(null)
    })
  }

  const statusLabel = useMemo(() => {
    if (!status) return { text: '读取中', tone: 'blue' }
    if (status.running) return { text: '运行中', tone: 'good' }
    if (status.lastError) return { text: '启动失败', tone: 'fail' }
    return { text: '已停止', tone: 'warn' }
  }, [status])

  if (!api) {
    return (
      <div className="sbody on">
        <h2>MCP 服务</h2>
        <p className="sub">让外部 agent 直接操作绘世</p>
        <div className="provider">
          <div className="empty-state">MCP 服务仅在桌面版可用，浏览器版没有本地进程。</div>
        </div>
      </div>
    )
  }

  const entries = logPage?.items ?? []
  const total = logPage?.total ?? 0
  const pageCount = logPage?.pageCount ?? 1

  return (
    <div className="sbody on">
      <h2>MCP 服务</h2>
      <p className="sub">把绘世暴露成一个 MCP Server，Codex / Claude Code / Cursor 配好即可生成与检索图片</p>

      {error ? <div className="mcp-alert">{error}</div> : null}

      <div className="provider">
        <div className="provider-head">
          <div className="pv-logo"><Plug size={16} /></div>
          <div>
            <div className="pv-name">本地 MCP 服务</div>
            <div className="pv-sub mcp-mono">{status ? status.endpoint : '—'}</div>
          </div>
          <span className={`pill ${statusLabel.tone} tag-ok`}>{statusLabel.text}</span>
        </div>

        <div className="mcp-metrics">
          <Metric label="监听" value={status?.running ? `:${status.port}` : '未监听'} />
          <Metric label="会话" value={status ? String(status.sessionCount) : '—'} />
          <Metric label="工具" value={status ? String(status.toolCount) : '—'} />
          <Metric label="调用 / 失败" value={status ? `${status.callCount} / ${status.errorCount}` : '—'} />
        </div>

        {status?.lastError ? <div className="mcp-alert">{status.lastError}</div> : null}

        <div className="mcp-row">
          <span>启用服务</span>
          <button
            type="button"
            className={`mcp-switch ${status?.enabled ? 'on' : ''}`}
            disabled={busy}
            aria-pressed={status?.enabled === true}
            onClick={toggleEnabled}
          >
            <i />
            {status?.enabled ? '已开启' : '已关闭'}
          </button>
        </div>
        <em className="hint-mini">
          只监听 127.0.0.1，局域网访问不到；关闭后端口立即释放。改动端口会重启服务。
        </em>

        <div className="field">
          <span>端口</span>
          <div className="input-with-action">
            <input
              className="input-control"
              inputMode="numeric"
              value={portDraft}
              aria-label="MCP 端口"
              onChange={(event) => {
                setPortDraft(event.target.value)
                setPortError(null)
              }}
            />
            <button type="button" className="btn-ghost-border" disabled={busy} onClick={savePort}>
              保存端口
            </button>
          </div>
          {portError ? <em className="mcp-field-error">{portError}</em> : null}
        </div>

        <div className="field">
          <span>访问 token</span>
          <div className="input-with-action mcp-token-row">
            <input
              className="input-control mcp-mono"
              type={showToken ? 'text' : 'password'}
              value={token}
              readOnly
              aria-label="MCP token"
            />
            <button
              type="button"
              className={`input-action ${showToken ? 'on' : ''}`}
              title={showToken ? '隐藏 token' : '显示 token'}
              aria-label={showToken ? '隐藏 token' : '显示 token'}
              onClick={() => setShowToken((value) => !value)}
            >
              {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <button
              type="button"
              className={`input-action ${copiedKey === 'token' ? 'on' : ''}`}
              title="复制 token"
              aria-label="复制 token"
              onClick={() => void copy('token', token)}
            >
              {copiedKey === 'token' ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
          <em className="hint-mini">
            客户端配置里必须带这个 token。重置后旧 token 立即失效，已连接的客户端需要重新配置。
          </em>
        </div>

        <div className="provider-actions">
          {confirmingRotate ? (
            <>
              <button className="mcp-danger" disabled={busy} onClick={rotateToken}>
                确认重置
              </button>
              <button className="btn-ghost-border" disabled={busy} onClick={() => setConfirmingRotate(false)}>
                取消
              </button>
            </>
          ) : (
            <button className="btn-ghost-border" disabled={busy} onClick={() => setConfirmingRotate(true)}>
              <RotateCcw size={13} /> 重置 token
            </button>
          )}
        </div>
      </div>

      <h3 className="mcp-section">客户端配置</h3>
      <p className="sub">stdio 兼容性最好；已支持 Streamable HTTP 的客户端用 HTTP 版本。路径按软件当前位置生成，移动安装目录后请重新复制。</p>
      {snippets.length > 0 && !snippets.some((snippet) => snippet.id.endsWith('-stdio')) ? (
        <div className="mcp-alert">stdio 桥还没构建，当前只提供 HTTP 配置；运行一次 <code>pnpm build</code> 即可生成。</div>
      ) : null}
      <div className="mcp-snippets">
        {snippets.map((snippet) => (
          <div className="mcp-snippet" key={snippet.id}>
            <div className="mcp-snippet-head">
              <div>
                <b>{snippet.label}</b>
                <em>{snippet.hint}</em>
              </div>
              <button
                type="button"
                className={`btn-ghost-border ${copiedKey === snippet.id ? 'on' : ''}`}
                onClick={() => void copy(snippet.id, snippet.content)}
              >
                {copiedKey === snippet.id ? <Check size={13} /> : <Copy size={13} />}
                {copiedKey === snippet.id ? '已复制' : '复制'}
              </button>
            </div>
            <pre className="mcp-code">{snippet.content}</pre>
          </div>
        ))}
      </div>

      <h3 className="mcp-section">
        调用日志
        <span className="mcp-log-count">{total}</span>
      </h3>
      <div className="mcp-log-tools">
        <label className="mcp-check">
          <input
            type="checkbox"
            checked={onlyErrors}
            onChange={(event) => {
              setOnlyErrors(event.target.checked)
              setPage(1)
              setExpandedId(null)
            }}
          />
          只看失败
        </label>
        <div className="mcp-log-actions">
          <button type="button" className="btn-ghost-border" disabled={busy} onClick={() => void refresh(onlyErrors, page)}>
            <RefreshCw size={13} /> 刷新
          </button>
          {confirmingClear ? (
            <>
              <button type="button" className="mcp-danger" disabled={busy} onClick={clearLogs}>
                确认清空
              </button>
              <button type="button" className="btn-ghost-border" disabled={busy} onClick={() => setConfirmingClear(false)}>
                取消
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn-ghost-border"
              disabled={busy || total === 0}
              onClick={() => setConfirmingClear(true)}
            >
              <Trash2 size={13} /> 清空
            </button>
          )}
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="provider">
          <div className="empty-state">还没有调用记录。配置好客户端后，第一条 initialize 就会出现在这里。</div>
        </div>
      ) : (
        <>
          <div className="mcp-log-table">
            <div className="mcp-log-row head">
              <span>时间</span>
              <span>工具</span>
              <span>状态</span>
              <span>耗时</span>
              <span>摘要</span>
            </div>
            {entries.map((entry) => {
              const expanded = expandedId === entry.id
              return (
                <div className={`mcp-log-item ${expanded ? 'open' : ''}`} key={entry.id}>
                  <button
                    type="button"
                    className={`mcp-log-row ${entry.ok ? '' : 'fail'}`}
                    aria-expanded={expanded}
                    onClick={() => setExpandedId(expanded ? null : entry.id)}
                  >
                    <span className="mcp-mono">{formatTime(entry.at)}</span>
                    <span className="mcp-mono mcp-log-tool">{entry.tool}</span>
                    <span>
                      <i className={`mcp-dot ${entry.ok ? 'ok' : 'fail'}`} />
                      {entry.ok ? '成功' : '失败'}
                    </span>
                    <span className="mcp-mono">{formatLatency(entry.durationMs)}</span>
                    <span className="mcp-log-summary">
                      {entry.error || entry.summary || '—'}
                      <ChevronDown size={12} className="mcp-log-chevron" />
                    </span>
                  </button>
                  {expanded ? <LogDetail entry={entry} /> : null}
                </div>
              )
            })}
          </div>

          <div className="mcp-pager">
            <span className="mcp-mono">
              第 {page} / {pageCount} 页 · 共 {total} 条
            </span>
            <div className="mcp-log-actions">
              <button
                type="button"
                className="btn-ghost-border"
                disabled={page <= 1 || busy}
                onClick={() => {
                  setPage(Math.max(1, page - 1))
                  setExpandedId(null)
                }}
              >
                <ChevronLeft size={13} /> 上一页
              </button>
              <button
                type="button"
                className="btn-ghost-border"
                disabled={page >= pageCount || busy}
                onClick={() => {
                  setPage(Math.min(pageCount, page + 1))
                  setExpandedId(null)
                }}
              >
                下一页 <ChevronRight size={13} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function LogDetail({ entry }: { entry: McpLogEntry }): JSX.Element {
  return (
    <div className="mcp-log-detail">
      <div className="mcp-log-detail-grid">
        <DetailItem label="时间" value={new Date(entry.at).toLocaleString('zh-CN', { hour12: false })} mono />
        <DetailItem label="耗时" value={formatLatency(entry.durationMs)} mono />
        <DetailItem label="客户端" value={entry.clientName || '（未提供）'} />
        <DetailItem label="结果" value={entry.ok ? '成功' : '失败'} />
      </div>
      <DetailItem label="入参摘要" value={entry.summary || '（无）'} block />
      {entry.error ? <DetailItem label="错误" value={entry.error} block danger /> : null}
      <div className="mcp-log-detail-id mcp-mono">id {entry.id}</div>
    </div>
  )
}

function DetailItem({
  label,
  value,
  mono,
  block,
  danger
}: {
  label: string
  value: string
  mono?: boolean
  block?: boolean
  danger?: boolean
}): JSX.Element {
  return (
    <div className={`mcp-detail-item ${block ? 'block' : ''}`}>
      <em>{label}</em>
      <span className={`${mono ? 'mcp-mono' : ''} ${danger ? 'mcp-detail-danger' : ''}`}>{value}</span>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="mcp-metric">
      <em>{label}</em>
      <b>{value}</b>
    </div>
  )
}

/** 毫秒级调用显示毫秒，别让 12ms 被四舍五入成「0s」 */
function formatLatency(ms: number): string {
  return ms < 1000 ? `${Math.max(0, Math.round(ms))}ms` : formatDuration(ms)
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '--:--:--'
  return date.toLocaleTimeString('zh-CN', { hour12: false })
}
