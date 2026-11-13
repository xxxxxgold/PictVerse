import { useEffect, useMemo, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import {
  Boxes,
  Eye,
  EyeOff,
  FolderOpen,
  Info,
  Keyboard,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  X
} from 'lucide-react'
import { useAppStore } from '@renderer/store/app-store'
import { GallerySelect } from '@renderer/components/gallery/GallerySelect'
import { appVersion, repositoryUrl } from '@shared/app-version'
import type { CapabilityOverride, PricingMode, Provider, PromptAssistantProtocol } from '@shared/types'
import {
  DEFAULT_PROMPT_ASSIST_CONFIG,
  normalizePromptAssistConfig,
  PROMPT_CONTEXT_OPTIONS,
  PROMPT_OUTPUT_OPTIONS,
  PROMPT_REASONING_OPTIONS,
  type PromptAssistConfig
} from '@shared/prompt-assistant'
import { resolveModelCapabilities } from '@shared/image-options'

type TabKey = 'providers' | 'assistant' | 'keys' | 'about'

type AssistantConfig = PromptAssistConfig

const assistantProtocolOptions: Array<{ value: PromptAssistantProtocol; label: string }> = [
  { value: 'chat', label: 'chat（OpenAI /v1/chat/completions）' },
  { value: 'responses', label: 'responses（OpenAI /v1/responses）' },
  { value: 'anthropic', label: 'anthropic（Anthropic /v1/messages）' }
]

const emptyAssistant: AssistantConfig = {
  ...DEFAULT_PROMPT_ASSIST_CONFIG
}

const ASSISTANT_STORAGE_KEY = 'pictverse-assistant-config'

function readAssistantModels(): string[] {
  try {
    const raw = window.localStorage.getItem(`${ASSISTANT_STORAGE_KEY}:models`)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === 'string')
    }
  } catch {
    /* 忽略损坏数据 */
  }
  return []
}

function readAssistantConfig(): AssistantConfig {
  try {
    const raw = window.localStorage.getItem(ASSISTANT_STORAGE_KEY)
    if (raw) return { ...emptyAssistant, ...(JSON.parse(raw) as Partial<AssistantConfig>) }
  } catch {
    /* 忽略损坏的本地配置 */
  }
  return { ...emptyAssistant }
}

const tabs: Array<{ key: TabKey; label: string; icon: JSX.Element }> = [
  { key: 'providers', label: '供应商', icon: <Boxes size={15} /> },
  { key: 'assistant', label: '提示词助手', icon: <Sparkles size={15} /> },
  { key: 'keys', label: '快捷键', icon: <Keyboard size={15} /> },
  { key: 'about', label: '关于', icon: <Info size={15} /> }
]

const priceModes: Array<{ key: PricingMode; label: string }> = [
  { key: 'unified', label: '统一价' },
  { key: 'tiered', label: '按分辨率分档' },
  { key: 'token', label: '按 token' }
]

/** 能力三行：key 为覆盖档位字段 */
const capabilityFields = [
  { key: 'capabilityMask', derived: 'mask', label: '遮罩' },
  { key: 'capabilityGif', derived: 'gif', label: 'GIF' },
  { key: 'capabilitySvg', derived: 'svg', label: 'SVG' }
] as const

const overrideLabels: Record<CapabilityOverride, string> = { auto: '自动', on: '开', off: '关' }

/** 点击循环：自动 → 强制开 → 强制关 → 自动 */
function nextCapabilityOverride(current: CapabilityOverride | undefined): CapabilityOverride {
  if (current === 'auto' || current === undefined) return 'on'
  return current === 'on' ? 'off' : 'auto'
}

const shortcuts: Array<[string, string]> = [
  ['新建会话', 'Ctrl N'],
  ['展开/收起会话', 'Ctrl ['],
  ['展开/收起参数', 'Ctrl ]'],
  ['打开设置', 'Ctrl ,'],
  ['开始生成', 'Ctrl Enter'],
  ['历史提示词', 'Alt H'],
  ['切换主题', 'Ctrl Shift L']
]

export function SettingsModal({ onClose }: { onClose: () => void }): JSX.Element {
  const {
    providers,
    activeProviderId,
    settings,
    saveProvider,
    deleteProvider,
    makeProviderDefault,
    fetchProviderModels,
    saveProviderModels,
    updateSettings,
    notify,
  } = useAppStore()

  const [tab, setTab] = useState<TabKey>('providers')
  const [assistantDraft, setAssistantDraft] = useState<AssistantConfig | null>(readAssistantConfig())
  const [assistantModels, setAssistantModels] = useState<string[]>(readAssistantModels)
  const [assistantFetching, setAssistantFetching] = useState(false)
  const [draft, setDraft] = useState<Provider | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [newModel, setNewModel] = useState('')
  const [fetching, setFetching] = useState(false)
  const [showProviderKey, setShowProviderKey] = useState(false)
  const [showAssistantKey, setShowAssistantKey] = useState(false)

  const active = useMemo(
    () => providers.find((item) => item.id === activeProviderId) || providers[0] || null,
    [activeProviderId, providers]
  )

  useEffect(() => {
    setDraft(active ? { ...active } : null)
  }, [active])

  useEffect(() => {
    if (!active) {
      setModels([])
      return
    }
    void window.pictverse.provider.models(active.id).then((rows) => setModels(rows.map((row) => row.modelId)))
  }, [active])

  const patch = (input: Partial<Provider>) => setDraft((current) => (current ? { ...current, ...input } : current))

  const fetchAssistantModels = async () => {
    const draft = assistantDraft || emptyAssistant
    if (!draft.baseURL.trim()) {
      notify('请先填写提示词服务的 Base URL')
      return
    }
    setAssistantFetching(true)
    try {
      const headers: Record<string, string> = { Accept: 'application/json' }
      if (draft.apiKey) headers.Authorization = `Bearer ${draft.apiKey}`
      const response = await fetch(`${draft.baseURL.trim().replace(/\/+$/, '')}/v1/models`, { headers })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload: unknown = await response.json()
      const list = Array.isArray(payload)
        ? payload
        : payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)
          ? (payload as { data: unknown[] }).data
          : []
      const ids = list
        .map((entry) =>
          typeof entry === 'string'
            ? entry
            : entry && typeof entry === 'object'
              ? (entry as { id?: string }).id
              : null
        )
        .filter((id): id is string => Boolean(id))
      setAssistantModels(ids)
      try {
        window.localStorage.setItem(`${ASSISTANT_STORAGE_KEY}:models`, JSON.stringify(ids))
      } catch {
        /* 忽略存储失败 */
      }
      notify(ids.length ? `获取到 ${ids.length} 个模型` : '服务没有返回模型')
    } catch (error) {
      notify(error instanceof Error ? `获取模型失败：${error.message}` : '获取模型失败')
    } finally {
      setAssistantFetching(false)
    }
  }

  const saveAssistant = () => {
    if (!assistantDraft) return
    try {
      window.localStorage.setItem(ASSISTANT_STORAGE_KEY, JSON.stringify(assistantDraft))
    } catch {
      /* 存储失败时静默 */
    }
    void updateSettings({ promptModel: assistantDraft.model })
    notify('提示词服务已保存')
  }

  const handleFetch = async () => {
    if (!draft) return
    setFetching(true)
    try {
      const list = await fetchProviderModels(draft.id)
      if (list.length) setModels((current) => Array.from(new Set([...current, ...list])))
    } finally {
      setFetching(false)
    }
  }

  const handleChooseImagesRoot = async () => {
    try {
      const dir = await window.pictverse.settings.chooseImagesRoot?.()
      if (!dir) return
      await updateSettings({ imagesRoot: dir })
    } catch (error) {
      notify(error instanceof Error ? error.message : '无法更新图片存储位置')
    }
  }

  const handleResetImagesRoot = async () => {
    try {
      await updateSettings({ imagesRoot: '' })
    } catch (error) {
      notify(error instanceof Error ? error.message : '无法恢复默认目录')
    }
  }

  /** 按该供应商默认模型算出的最终能力（已计入三态覆盖），循环外只算一次 */
  const draftCaps = draft
    ? resolveModelCapabilities(draft.defaultModel, draft)
    : { mask: false, gif: false, svg: false }

  return createPortal(
    <div
      className="modal open"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="settings-modal">
        <button className="settings-close" onClick={onClose} title="关闭">
          <X size={16} />
        </button>
        <nav className="settings-nav">
          <h3>设置</h3>
          {tabs.map((item) => (
            <button
              key={item.key}
              className={`snav ${tab === item.key ? 'on' : ''}`}
              onClick={() => setTab(item.key)}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        <div className="settings-body">
          {tab === 'providers' ? (
            <div className="sbody on">
              <h2>供应商</h2>
              <p className="sub">可添加多个供应商，价格支持统一价或 1K / 2K / 4K 分档</p>

              <div className="provider default-row">
                <div className="two-col">
                  <label className="field">
                    <span>默认供应商</span>
                    <GallerySelect
                      value={active?.id || ''}
                      options={providers.map((item) => ({ value: item.id, label: item.name }))}
                      ariaLabel="默认供应商"
                      className="settings-select"
                      onChange={(id) => void makeProviderDefault(id)}
                    />
                  </label>
                  <label className="field">
                    <span>默认模型</span>
                    <GallerySelect
                      value={settings?.defaultModel || active?.defaultModel || ''}
                      options={(models.length ? models : [settings?.defaultModel || '']).filter(Boolean).map((m) => ({ value: m, label: m }))}
                      ariaLabel="默认模型"
                      className="settings-select"
                      onChange={(model) => void updateSettings({ defaultModel: model })}
                    />
                  </label>
                </div>
              </div>
                  {window.pictverse.settings.chooseImagesRoot ? (
                    <div className="field">
                      <span>图片存储位置</span>
                      <div className="input-with-action">
                        <input
                          className="input-control"
                          value={settings?.imagesRootEffective || ''}
                          placeholder="默认数据目录"
                          readOnly
                        />
                        <button
                          type="button"
                          className="input-action"
                          title="浏览…"
                          aria-label="选择图片存储位置"
                          onClick={() => void handleChooseImagesRoot()}
                        >
                          <FolderOpen size={14} />
                        </button>
                      </div>
                      <em className="hint-mini">
                        图片将按会话存入该目录下的子文件夹；更改仅对新图片生效
                        {settings?.imagesRoot ? (
                          <button
                            type="button"
                            className="ghost"
                            title="恢复默认目录"
                            onClick={() => void handleResetImagesRoot()}
                          >
                            <RotateCcw size={12} /> 恢复默认
                          </button>
                        ) : null}
                      </em>
                    </div>
                  ) : null}

              <div className="provlist">
                {providers.map((item) => (
                  <button
                    key={item.id}
                    className={`provitem ${item.id === active?.id ? 'on' : ''}`}
                    onClick={() => useAppStore.setState({ activeProviderId: item.id })}
                  >
                    <span className="pv-dot" />
                    <span className="pv-t">
                      <b>{item.name}</b>
                      <em>{item.baseURL || '未配置地址'}</em>
                    </span>
                    {item.isDefault ? <span className="pill good">默认</span> : null}
                  </button>
                ))}
                <button className="provitem add" onClick={() => void saveProvider({ name: '新供应商', baseURL: '' })}>
                  <Plus size={14} />
                  新增供应商
                </button>
              </div>

              {draft ? (
                <div className="provider">
                  <div className="provider-head">
                    <div className="pv-logo">{draft.name.slice(0, 2).toUpperCase()}</div>
                    <div>
                      <div className="pv-name">{draft.name}</div>
                      <div className="pv-sub">{draft.baseURL || '未配置'}</div>
                    </div>
                    <span className="pill good tag-ok">{draft.isDefault ? '默认' : '已保存'}</span>
                  </div>

                  <div className="two-col">
                    <label className="field">
                      <span>名称</span>
                      <input className="input-control" value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
                    </label>
                    <label className="field">
                      <span>Base URL</span>
                      <input
                        className="input-control"
                        value={draft.baseURL}
                        placeholder="https://api.openai.com"
                        onChange={(e) => patch({ baseURL: e.target.value })}
                      />
                    </label>
                  </div>

                  <div className="two-col">
                    <label className="field">
                      <span>API Key</span>
                      <div className="input-with-action">
                        <input
                          className="input-control"
                          type={showProviderKey ? 'text' : 'password'}
                          value={draft.apiKey ?? ''}
                          onChange={(e) => patch({ apiKey: e.target.value || null })}
                        />
                        <button
                          type="button"
                          className={`input-action ${showProviderKey ? 'on' : ''}`}
                          title={showProviderKey ? '隐藏密钥' : '显示密钥'}
                          aria-label={showProviderKey ? '隐藏密钥' : '显示密钥'}
                          aria-pressed={showProviderKey}
                          onClick={() => setShowProviderKey((value) => !value)}
                        >
                          {showProviderKey ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    </label>
                    <label className="field">
                      <span>默认模型</span>
                      <input
                        className="input-control"
                        value={draft.defaultModel}
                        onChange={(e) => patch({ defaultModel: e.target.value })}
                      />
                    </label>
                  </div>

                  <div className="field">
                    <span>
                      能力
                      <em className="hint-mini">按 {draft.defaultModel || '未设置模型'} 推导</em>
                    </span>
                    <div className="segmented capability-segmented">
                      {capabilityFields.map(({ key, derived, label }) => {
                        const override = draft[key] ?? 'auto'
                        // 高亮始终表示「最终是否启用」，已把 override 计入，避免角标写「关」却亮着
                        const enabled = draftCaps[derived]
                        const title =
                          override === 'auto'
                            ? `自动 · 按模型推导为${enabled ? '开' : '关'}，点击改为强制开启`
                            : override === 'on'
                              ? '强制开启，点击改为强制关闭'
                              : '强制关闭，点击恢复跟随模型'
                        return (
                          <button
                            key={key}
                            className={enabled ? 'on' : ''}
                            title={title}
                            onClick={() => patch({ [key]: nextCapabilityOverride(override) })}
                          >
                            {label}
                            <em className={`cap-badge ${override}`}>{overrideLabels[override]}</em>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div className="field">
                    <span>定价模式</span>
                    <div className="segmented">
                      {priceModes.map((mode) => (
                        <button
                          key={mode.key}
                          className={draft.pricingMode === mode.key ? 'on' : ''}
                          onClick={() => patch({ pricingMode: mode.key })}
                        >
                          {mode.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {draft.pricingMode === 'unified' ? (
                    <label className="field">
                      <span>单价（元/张）</span>
                      <input
                        className="input-control"
                        type="number"
                        step="0.01"
                        value={draft.priceUnified ?? ''}
                        onChange={(e) => patch({ priceUnified: e.target.value ? Number(e.target.value) : null })}
                      />
                    </label>
                  ) : null}

                  {draft.pricingMode === 'tiered' ? (
                    <div className="three-col">
                      <label className="field">
                        <span>1K（元/张）</span>
                        <input
                          className="input-control"
                          type="number"
                          step="0.01"
                          value={draft.price1K ?? ''}
                          onChange={(e) => patch({ price1K: e.target.value ? Number(e.target.value) : null })}
                        />
                      </label>
                      <label className="field">
                        <span>2K（元/张）</span>
                        <input
                          className="input-control"
                          type="number"
                          step="0.01"
                          value={draft.price2K ?? ''}
                          onChange={(e) => patch({ price2K: e.target.value ? Number(e.target.value) : null })}
                        />
                      </label>
                      <label className="field">
                        <span>4K（元/张）</span>
                        <input
                          className="input-control"
                          type="number"
                          step="0.01"
                          value={draft.price4K ?? ''}
                          onChange={(e) => patch({ price4K: e.target.value ? Number(e.target.value) : null })}
                        />
                      </label>
                    </div>
                  ) : null}

                  {draft.pricingMode === 'token' ? (
                    <div className="three-col">
                      <label className="field">
                        <span>文本输入 / 百万</span>
                        <input
                          className="input-control"
                          type="number"
                          step="0.1"
                          value={draft.rateTextInput ?? ''}
                          onChange={(e) => patch({ rateTextInput: e.target.value ? Number(e.target.value) : null })}
                        />
                      </label>
                      <label className="field">
                        <span>图像输入 / 百万</span>
                        <input
                          className="input-control"
                          type="number"
                          step="0.1"
                          value={draft.rateImageInput ?? ''}
                          onChange={(e) => patch({ rateImageInput: e.target.value ? Number(e.target.value) : null })}
                        />
                      </label>
                      <label className="field">
                        <span>图像输出 / 百万</span>
                        <input
                          className="input-control"
                          type="number"
                          step="0.1"
                          value={draft.rateImageOutput ?? ''}
                          onChange={(e) => patch({ rateImageOutput: e.target.value ? Number(e.target.value) : null })}
                        />
                      </label>
                    </div>
                  ) : null}

                  <div className="field">
                    <span>模型列表（{models.length}）</span>
                    <div className="modellist">
                      {models.length === 0 ? <div className="hint-mini">还没有模型，先获取或手动添加</div> : null}
                      {models.map((model) => (
                        <div key={model} className="modelrow">
                          <span className="mn">{model}</span>
                          <button
                            className="ghost"
                            onClick={() => {
                              const next = models.filter((item) => item !== model)
                              setModels(next)
                              void saveProviderModels(draft.id, next)
                            }}
                          >
                            移除
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="model-add">
                    <input
                      className="input-control"
                      placeholder="手动添加模型 ID"
                      value={newModel}
                      onChange={(e) => setNewModel(e.target.value)}
                    />
                    <button
                      className="btn-ghost-border"
                      onClick={() => {
                        if (!draft || !newModel.trim()) return
                        const next = Array.from(new Set([...models, newModel.trim()]))
                        setModels(next)
                        setNewModel('')
                        void saveProviderModels(draft.id, next)
                      }}
                    >
                      添加
                    </button>
                    <button className="btn-ghost-border" disabled={fetching} onClick={() => void handleFetch()}>
                      {fetching ? '获取中…' : '获取模型'}
                    </button>
                  </div>

                  <div className="provider-actions">
                    <button className="ghost" onClick={() => void deleteProvider(draft.id)}>
                      <Trash2 size={14} />
                      删除
                    </button>
                    <button className="ghost" onClick={() => void makeProviderDefault(draft.id)}>
                      设为默认
                    </button>
                    <button className="btn-primary" onClick={() => void saveProvider(draft, draft.id)}>
                      保存供应商
                    </button>
                  </div>
                </div>
              ) : (
                <div className="empty-state">还没有供应商，先新增一个</div>
              )}
            </div>
          ) : null}

          {tab === 'assistant' ? (
            <div className="sbody on">
              <h2>提示词助手</h2>
              <p className="sub">为灵感与丰富提示词单独配置服务，支持 chat / responses / anthropic 三种协议</p>

              <div className="provider">
                <div className="provider-head">
                  <div className="pv-logo">{(assistantDraft?.name || 'AI').slice(0, 2).toUpperCase()}</div>
                  <div>
                    <div className="pv-name">{assistantDraft?.name || '提示词服务'}</div>
                    <div className="pv-sub">{assistantDraft?.baseURL || '未配置'}</div>
                  </div>
                  <span className={`pill ${assistantDraft?.apiKey ? 'good' : 'warn'} tag-ok`}>
                    {assistantDraft?.apiKey ? '已配置' : '未配置'}
                  </span>
                </div>

                <div className="two-col">
                  <label className="field">
                    <span>名称</span>
                    <input
                      className="input-control"
                      value={assistantDraft?.name || ''}
                      onChange={(e) => setAssistantDraft((cur) => ({ ...(cur || emptyAssistant), name: e.target.value }))}
                    />
                  </label>
                  <label className="field">
                    <span>Base URL</span>
                    <input
                      className="input-control"
                      placeholder="https://api.openai.com"
                      value={assistantDraft?.baseURL || ''}
                      onChange={(e) => setAssistantDraft((cur) => ({ ...(cur || emptyAssistant), baseURL: e.target.value }))}
                    />
                  </label>
                </div>

                <div className="two-col">
                  <label className="field">
                    <span>API Key</span>
                    <div className="input-with-action">
                      <input
                        className="input-control"
                        type={showAssistantKey ? 'text' : 'password'}
                        value={assistantDraft?.apiKey || ''}
                        onChange={(e) => setAssistantDraft((cur) => ({ ...(cur || emptyAssistant), apiKey: e.target.value }))}
                      />
                      <button
                        type="button"
                        className={`input-action ${showAssistantKey ? 'on' : ''}`}
                        title={showAssistantKey ? '隐藏密钥' : '显示密钥'}
                        aria-label={showAssistantKey ? '隐藏密钥' : '显示密钥'}
                        aria-pressed={showAssistantKey}
                        onClick={() => setShowAssistantKey((value) => !value)}
                      >
                        {showAssistantKey ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </label>
                  <label className="field">
                    <span>模型</span>
                    <div className="model-add">
                      <GallerySelect
                        value={assistantDraft?.model || ''}
                        options={(assistantModels.length
                          ? assistantModels
                          : [assistantDraft?.model || DEFAULT_PROMPT_ASSIST_CONFIG.model]
                        ).filter(Boolean).map((m) => ({ value: m, label: m }))}
                        ariaLabel="提示词模型"
                        className="settings-select"
                        onChange={(model) => setAssistantDraft((cur) => ({ ...(cur || emptyAssistant), model }))}
                      />
                      <button
                        className="btn-ghost-border"
                        disabled={assistantFetching}
                        onClick={() => void fetchAssistantModels()}
                      >
                        {assistantFetching ? '获取中…' : '获取模型'}
                      </button>
                    </div>
                  </label>
                </div>

                <div className="field">
                  <span>协议</span>
                  <GallerySelect
                    value={assistantDraft?.protocol || 'chat'}
                    options={assistantProtocolOptions}
                    ariaLabel="接口协议"
                    className="settings-select"
                    onChange={(protocol) =>
                      setAssistantDraft((cur) => ({ ...(cur || emptyAssistant), protocol }))
                    }
                  />
                </div>

                <div className="three-col">
                  <label className="field">
                    <span>上下文（K tokens）</span>
                    <GallerySelect
                      value={assistantDraft?.contextK ?? 0}
                      options={PROMPT_CONTEXT_OPTIONS.map((value) => ({
                        value,
                        label: value === 0 ? '默认' : `${value}K`
                      }))}
                      ariaLabel="上下文长度"
                      className="settings-select"
                      onChange={(contextK) => setAssistantDraft((cur) => ({ ...(cur || emptyAssistant), contextK }))}
                    />
                  </label>
                  <label className="field">
                    <span>输出长度（tokens）</span>
                    <GallerySelect
                      value={assistantDraft?.maxOutputTokens ?? 700}
                      options={PROMPT_OUTPUT_OPTIONS.map((value) => ({
                        value,
                        label: value === 0 ? '默认' : String(value)
                      }))}
                      ariaLabel="输出长度"
                      className="settings-select"
                      onChange={(maxOutputTokens) =>
                        setAssistantDraft((cur) => ({ ...(cur || emptyAssistant), maxOutputTokens }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>思考强度</span>
                    <GallerySelect
                      value={assistantDraft?.reasoning || 'off'}
                      options={PROMPT_REASONING_OPTIONS.map((item) => ({ value: item.key, label: item.label }))}
                      ariaLabel="思考强度"
                      className="settings-select"
                      onChange={(reasoning) => setAssistantDraft((cur) => ({ ...(cur || emptyAssistant), reasoning }))}
                    />
                  </label>
                </div>

                <div className="provider-actions">
                  <button className="btn-primary" onClick={saveAssistant}>
                    保存提示词服务
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {tab === 'keys' ? (
            <div className="sbody on">
              <h2>快捷键</h2>
              <p className="sub">当前版本为只读展示</p>
              <div className="provider">
                {shortcuts.map(([label, combo]) => (
                  <div key={label} className="row-line">
                    {label}
                    <input className="input-control shortcut-input" value={combo} readOnly />
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {tab === 'about' ? (
            <div className="sbody on">
              <h2>关于</h2>
              <p className="sub">绘世 PictVerse · 本地 AI 绘画工作台</p>
              <div className="about-grid">
                <div className="about-item">
                  <div className="k">版本</div>
                  <div className="v mono">v{appVersion}</div>
                </div>
                <div className="about-item">
                  <div className="k">构建</div>
                  <div className="v mono">electron · react 19</div>
                </div>
                <div className="about-item">
                  <div className="k">开源许可</div>
                  <div className="v mono">MIT</div>
                </div>
                <div className="about-item">
                  <div className="k">GitHub</div>
                  <button
                    type="button"
                    className="about-link mono"
                    title={repositoryUrl}
                    onClick={() => void window.pictverse.shell.openExternal(repositoryUrl)}
                  >
                    {repositoryUrl.replace(/^https?:\/\//, '')}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  )
}
