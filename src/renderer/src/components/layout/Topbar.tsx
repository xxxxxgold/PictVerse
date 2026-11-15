import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import {
  BookOpen,
  Copy,
  Image as ImageIcon,
  Minus,
  Moon,
  PencilLine,
  Plus,
  Settings,
  Square,
  Sun,
  X
} from 'lucide-react'
import { useAppStore } from '@renderer/store/app-store'
import { resolveActiveProvider } from '@shared/provider-selection'
import logoUrl from '@renderer/assets/icon.png'

function hostOf(baseURL: string | undefined): string {
  if (!baseURL) return '未配置'
  return baseURL.replace(/^https?:\/\//, '').split('/')[0] || '未配置'
}

export function Topbar(): JSX.Element {
  const {
    settings,
    conversations,
    activeConversationId,
    darkMode,
    view,
    setView,
    toggleTheme,
    createConversation,
    setSettingsModalOpen,
    providers
  } = useAppStore()
  const windowApi = window.pictverse.window ?? null
  const [isMaximized, setIsMaximized] = useState(() => windowApi?.isMaximized() ?? false)

  useEffect(() => {
    if (!windowApi) return
    return windowApi.onMaximizeChange(setIsMaximized)
  }, [windowApi])

  const conversation = conversations.find((item) => item.id === activeConversationId) || null
  const activeProvider = resolveActiveProvider(conversation?.providerId, providers)
  const host = hostOf(activeProvider?.baseURL || settings?.baseURL)
  const model = conversation?.model || settings?.defaultModel || '未选择'

  return (
    <header className="topbar">
      <div className="brand">
        <div className="logo">
          <img src={logoUrl} alt="绘世" />
        </div>
        <b>绘世</b>
        <span className={settings?.apiKeyStored ? 'live' : 'live warn'} />
      </div>

      <div className="param-tags">
        <div className="ptag accent" title={`${host} · ${model}`}>
          <span className="dot" />
          <span className="k">供应商</span>
          <b>{host}</b>
          <span className="k">·</span>
          <b>{model}</b>
        </div>
        <div className="ptag saved" title="参数已自动保存">
          <b>已保存</b>
        </div>
      </div>

      <div className="spacer" />

      <button
        className={`icon-btn ${view === 'gallery' ? 'on' : ''}`}
        title="图库"
        onClick={() => setView('gallery')}
      >
        <ImageIcon size={17} />
      </button>
      <button
        className={`icon-btn ${view === 'prompts' ? 'on' : ''}`}
        title="提示词库"
        onClick={() => setView('prompts')}
      >
        <BookOpen size={17} />
      </button>
      <button className={`icon-btn ${view === 'workspace' ? 'on' : ''}`} title="首页工作台" onClick={() => setView('workspace')}>
        <PencilLine size={17} />
      </button>

      <span className="topbar-divider" aria-hidden="true" />

      <button className="icon-btn" title="设置" onClick={() => setSettingsModalOpen(true)}>
        <Settings size={17} />
      </button>
      <button className="icon-btn" title={darkMode ? '切换到浅色' : '切换到深色'} onClick={toggleTheme}>
        {darkMode ? <Moon size={17} /> : <Sun size={17} />}
      </button>
      <button className="btn-primary" onClick={() => void createConversation()}>
        <Plus size={15} />
        新建会话
      </button>

      {windowApi ? (
        <div className="window-controls">
          <button
            className="win-btn"
            title="最小化"
            aria-label="最小化"
            onClick={() => windowApi.minimize()}
          >
            <Minus size={14} strokeWidth={2.2} />
          </button>
          <button
            className="win-btn"
            data-win-state={isMaximized ? 'restored' : 'maximized'}
            title={isMaximized ? '还原' : '最大化'}
            aria-label={isMaximized ? '还原' : '最大化'}
            onClick={() => windowApi.toggleMaximize()}
          >
            <span key={isMaximized ? 'restore' : 'max'} className="win-icon-in">
              {isMaximized ? <Copy size={12} strokeWidth={2.2} /> : <Square size={12} strokeWidth={2.2} />}
            </span>
          </button>
          <button
            className="win-btn win-close"
            title="关闭"
            aria-label="关闭"
            onClick={() => windowApi.close()}
          >
            <X size={14} strokeWidth={2.2} />
          </button>
        </div>
      ) : null}
    </header>
  )
}
