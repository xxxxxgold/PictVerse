import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, Trash2, X } from 'lucide-react'
import { useAppStore } from '@renderer/store/app-store'

const storageKey = (conversationId: string | null) => `pictverse-hidden-prompts:${conversationId || 'none'}`

function readHidden(conversationId: string | null): string[] {
  try {
    const raw = window.localStorage.getItem(storageKey(conversationId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function HistoryPromptsModal({ onClose }: { onClose: () => void }): JSX.Element {
  const { runsByConversation, activeConversationId } = useAppStore()
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [hidden, setHidden] = useState<string[]>(() => readHidden(activeConversationId))

  useEffect(() => {
    setHidden(readHidden(activeConversationId))
  }, [activeConversationId])

  // 只从「历史提示词」这个视图里隐藏，不删除生成记录，避免连带丢失图片
  const persist = useCallback(
    (next: string[]) => {
      setHidden(next)
      try {
        window.localStorage.setItem(storageKey(activeConversationId), JSON.stringify(next))
      } catch {
        /* 存储不可用时仅内存生效 */
      }
    },
    [activeConversationId]
  )

  const rows = useMemo(() => {
    const runs = activeConversationId ? runsByConversation[activeConversationId] || [] : []
    const seen = new Set<string>()
    return [...runs]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .filter((run) => {
        const key = run.prompt.trim()
        if (!key || seen.has(key) || hidden.includes(key)) return false
        seen.add(key)
        return true
      })
      .map((run) => ({
        id: run.id,
        prompt: run.prompt,
        createdAt: run.createdAt,
        size: run.size || run.ratio,
        quality: run.quality
      }))
  }, [activeConversationId, hidden, runsByConversation])

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(id)
      window.setTimeout(() => setCopiedId(null), 1400)
    } catch {
      setCopiedId(null)
    }
  }

  const removeOne = (prompt: string) => {
    const key = prompt.trim()
    if (!hidden.includes(key)) persist([...hidden, key])
  }

  const clearAll = () => {
    if (rows.length === 0) return
    persist(Array.from(new Set([...hidden, ...rows.map((row) => row.prompt.trim())])))
  }

  return createPortal(
    <div
      className="modal open"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="history-panel">
        <div className="history-head">
          <span>历史提示词</span>
          <span className="pill tiny">{rows.length} 条</span>
          <button
            className="history-clear"
            onClick={clearAll}
            disabled={rows.length === 0}
            title="清空当前会话的历史提示词"
          >
            <Trash2 size={13} />
            一键清空
          </button>
          <button className="history-close" onClick={onClose} title="关闭">
            <X size={15} />
          </button>
        </div>
        <div className="history-body">
          {rows.length === 0 ? (
            <div className="empty-state grid-empty">这个会话还没有生成记录</div>
          ) : (
            rows.map((row) => (
              <div
                key={row.id}
                className="history-row"
                role="button"
                tabIndex={0}
                onClick={() => void copy(row.id, row.prompt)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    void copy(row.id, row.prompt)
                  }
                }}
              >
                <p>{row.prompt}</p>
                <div className="history-row-meta">
                  <span>{new Date(row.createdAt).toLocaleString('zh-CN', { hour12: false }).slice(5, 16)}</span>
                  <span>{row.size}</span>
                  <span>{row.quality}</span>
                  <span className={`history-copy ${copiedId === row.id ? 'done' : ''}`}>
                    {copiedId === row.id ? <Check size={12} /> : <Copy size={12} />}
                    {copiedId === row.id ? '已复制' : '点击复制'}
                  </span>
                  <button
                    className="history-row-remove"
                    title="从历史中移除这条提示词"
                    onClick={(event) => {
                      event.stopPropagation()
                      removeOne(row.prompt)
                    }}
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
