import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { CircleHelp, Dices, Lock } from 'lucide-react'
import {
  DEFAULT_IMAGE_OUTPUT_FORMAT,
  IMAGE_BACKGROUNDS,
  IMAGE_INPUT_FIDELITIES,
  IMAGE_MODERATIONS,
  IMAGE_OUTPUT_FORMATS,
  IMAGE_RATIOS,
  formatImageQuality,
  getDefaultImageSize,
  getImageSizeOptions,
  getImageQualities,
  getOutputFormatsFor,
  isImage26,
  IMAGE_BACKGROUNDS_26,
  IMAGE_BACKGROUND_LABELS,
  IMAGE_INPUT_FIDELITY_LABELS,
  IMAGE_MODERATION_LABELS,
  IMAGE_OUTPUT_FORMAT_LABELS,
  resolveModelCapabilities,
  supportsImageInputFidelity
} from '@shared/image-options'
import type { ImageRatio } from '@shared/types'
import { resolveActiveProvider } from '@shared/provider-selection'
import { useAppStore } from '@renderer/store/app-store'
import { GallerySelect } from '@renderer/components/gallery/GallerySelect'

const ratios: ImageRatio[] = IMAGE_RATIOS

export function SettingsPanel(): JSX.Element {
  const { conversations, activeConversationId, updateActiveConversation, providers } = useAppStore()
  const conversation = conversations.find((item) => item.id === activeConversationId) || null
  const isImageToImage = (conversation?.referenceImages.length || 0) > 0
  const [providerModels, setProviderModels] = useState<string[]>([])
  const paramsFocus = useAppStore((state) => state.paramsFocus)
  const inspectorRef = useRef<HTMLElement>(null)

  const activeProviderId = resolveActiveProvider(conversation?.providerId, providers)?.id ?? null

  // 参数条快捷入口：定位到目标字段，必要时展开折叠分组并短暂高亮
  useEffect(() => {
    if (!paramsFocus) return
    const root = inspectorRef.current
    if (!root) return
    const target = root.querySelector<HTMLElement>(`[data-param-field="${paramsFocus.key}"]`)
    if (!target) return
    const group = target.closest('details')
    if (group && !group.open) group.open = true
    // 等抽屉与折叠区完成布局后再滚动，避免按展开前的位置定位
    const scrollTimer = window.setTimeout(() => {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' })
      target.classList.add('param-flash')
    }, 90)
    const flashTimer = window.setTimeout(() => target.classList.remove('param-flash'), 1600)
    return () => {
      window.clearTimeout(scrollTimer)
      window.clearTimeout(flashTimer)
      target.classList.remove('param-flash')
    }
  }, [paramsFocus])

  useEffect(() => {
    if (!activeProviderId) {
      setProviderModels([])
      return
    }
    let cancelled = false
    void window.pictverse.provider.models(activeProviderId).then((rows) => {
      if (!cancelled) setProviderModels(rows.map((row) => row.modelId))
    })
    return () => {
      cancelled = true
    }
  }, [activeProviderId])

  const modelOptions = useMemo(() => {
    const list = providerModels.length ? providerModels : [conversation?.model || '']
    return list.filter(Boolean).map((model) => ({ value: model, label: model }))
  }, [conversation?.model, providerModels])

  if (!conversation) return <aside className="inspector" ref={inspectorRef} />

  const activeProvider = resolveActiveProvider(conversation.providerId, providers)
  const capabilities = resolveModelCapabilities(conversation.model, activeProvider)
  const outputFormats = getOutputFormatsFor(conversation.model, activeProvider)
  const capsHint = [
    `遮罩${capabilities.mask ? '开' : '关'}`,
    `GIF${capabilities.gif ? '开' : '关'}`,
    `SVG${capabilities.svg ? '开' : '关'}`
  ].join(' · ')

  const sizeOptions = getImageSizeOptions(conversation.ratio)
  const selectedSize = sizeOptions.some((option) => option.value === conversation.size)
    ? conversation.size
    : getDefaultImageSize(conversation.ratio)

  return (
    <aside className="inspector" ref={inspectorRef}>
      <div className="config-stack">
        <section className="panel">
          <h3>当前会话参数</h3>
          <label className="field">
            <span>模型</span>
            <GallerySelect
              value={conversation.model}
              options={modelOptions}
              ariaLabel="选择模型"
              className="settings-select"
              onChange={(model) => void updateActiveConversation({ model })}
            />
          </label>
          <div className="field" data-param-field="ratio">
            <span>图片比例</span>
            <div className="segmented">
              {ratios.map((ratio) => (
                <button
                  key={ratio}
                  className={conversation.ratio === ratio ? 'on' : ''}
                  onClick={() => void updateActiveConversation({ ratio, size: getDefaultImageSize(ratio) })}
                >
                  {ratio}
                </button>
              ))}
            </div>
          </div>
          <div className="field" data-param-field="size">
            <span>分辨率</span>
            <GallerySelect
              value={selectedSize}
              options={sizeOptions}
              ariaLabel="选择分辨率"
              className="settings-select"
              onChange={(size) => void updateActiveConversation({ size })}
            />
          </div>
          <div className="field" data-param-field="quality">
            <span className="field-label-with-help">
              <span>质量</span>
              <button
                type="button"
                className="info-icon"
                title="quality：渲染精度档位。越高细节越精细、耗时越长、成本越高。与 2.6 的 complexity 不同——quality 管画质，complexity 管画面元素密度。"
                aria-label="质量说明"
              >
                <CircleHelp size={14} />
              </button>
            </span>
            <div className="segmented">
              {getImageQualities(conversation.model).map((quality) => (
                <button
                  key={quality}
                  className={conversation.quality === quality ? 'on' : ''}
                  onClick={() => void updateActiveConversation({ quality })}
                >
                  {formatImageQuality(quality)}
                </button>
              ))}
            </div>
          </div>
          <label className="field" data-param-field="count">
            <span>生成数量</span>
            <input
              className="input-control"
              type="number"
              min={1}
              max={10}
              value={conversation.n}
              onChange={(event) => void updateActiveConversation({ n: Number(event.target.value) })}
            />
          </label>
          <details className="advanced-settings">
            <summary>
              <span>高级设置</span>
              <span className={`pill tiny ${isImageToImage ? 'blue' : ''}`}>{isImageToImage ? '图生图' : '文生图'}</span>
            </summary>
            <div className="advanced-settings-body">
              <ToggleRow
                label="流式输出"
                help="开启后会以流式方式接收图片结果；默认关闭。"
                checked={conversation.stream}
                onChange={() => void updateActiveConversation({ stream: !conversation.stream })}
              />
              <label className="field" data-param-field="format">
                <span className="field-label-with-help">
                  <span>输出格式</span>
                  <button
                    type="button"
                    className="info-icon"
                    title={`控制最终图片文件格式，默认使用 ${DEFAULT_IMAGE_OUTPUT_FORMAT.toUpperCase()}。当前模型能力：${capsHint}`}
                    aria-label="输出格式说明"
                  >
                    <CircleHelp size={14} />
                  </button>
                </span>
                <GallerySelect
                  value={conversation.outputFormat}
                  options={outputFormats.map((value) => ({ value, label: IMAGE_OUTPUT_FORMAT_LABELS[value] }))}
                  ariaLabel="输出格式"
                  className="settings-select"
                  onChange={(outputFormat) => void updateActiveConversation({ outputFormat })}
                />
              </label>
              <label className="field">
                <span className="field-label-with-help">
                  <span>输出压缩</span>
                  <button
                    type="button"
                    className="info-icon"
                    title="仅 JPEG 和 WebP 有效，数值越高画质越好、文件越大。"
                    aria-label="输出压缩说明"
                  >
                    <CircleHelp size={14} />
                  </button>
                </span>
                <input
                  className="input-control"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={conversation.outputCompression ?? ''}
                  disabled={!['jpeg', 'webp'].includes(conversation.outputFormat)}
                  placeholder="留空"
                  onChange={(event) => {
                    const value = event.target.value.trim()
                    void updateActiveConversation({ outputCompression: value ? Number(value) : null })
                  }}
                />
              </label>
              <label className="field">
                <span className="field-label-with-help">
                  <span>背景</span>
                  <button
                    type="button"
                    className="info-icon"
                    title="选择是否保持自动背景或强制不透明背景。"
                    aria-label="背景说明"
                  >
                    <CircleHelp size={14} />
                  </button>
                </span>
                <GallerySelect
                  value={conversation.background}
                  options={(isImage26(conversation.model) ? IMAGE_BACKGROUNDS_26 : IMAGE_BACKGROUNDS).map((value) => ({ value, label: IMAGE_BACKGROUND_LABELS[value] }))}
                  ariaLabel="背景"
                  className="settings-select"
                  onChange={(background) => void updateActiveConversation({ background })}
                />
              </label>
              <label className="field">
                <span className="field-label-with-help">
                  <span>审核策略</span>
                  <button
                    type="button"
                    className="info-icon"
                    title="控制内容审核强度，默认使用自动策略。"
                    aria-label="审核策略说明"
                  >
                    <CircleHelp size={14} />
                  </button>
                </span>
                <GallerySelect
                  value={conversation.moderation}
                  options={IMAGE_MODERATIONS.map((value) => ({ value, label: IMAGE_MODERATION_LABELS[value] }))}
                  ariaLabel="审核策略"
                  className="settings-select"
                  onChange={(moderation) => void updateActiveConversation({ moderation })}
                />
              </label>
              <label className="field">
                <span className="field-label-with-help">
                  <span>中间图数量</span>
                  <button
                    type="button"
                    className="info-icon"
                    title="仅流式输出时有效，范围为 0 到 3。"
                    aria-label="中间图数量说明"
                  >
                    <CircleHelp size={14} />
                  </button>
                </span>
                <input
                  className="input-control"
                  type="number"
                  min={0}
                  max={3}
                  step={1}
                  value={conversation.partialImages ?? 0}
                  disabled={!conversation.stream}
                  onChange={(event) => void updateActiveConversation({ partialImages: Number(event.target.value) })}
                />
              </label>
              {isImageToImage && supportsImageInputFidelity(conversation.model) ? (
                <label className="field">
                  <span className="field-label-with-help">
                    <span>输入保真度</span>
                    <button
                      type="button"
                      className="info-icon"
                      title="编辑场景下控制对输入参考图细节的保留程度。"
                      aria-label="输入保真度说明"
                    >
                      <CircleHelp size={14} />
                    </button>
                  </span>
                  <GallerySelect
                    value={conversation.inputFidelity ?? ''}
                    options={[
                      { value: '', label: '保持默认' },
                      ...IMAGE_INPUT_FIDELITIES.map((value) => ({ value, label: IMAGE_INPUT_FIDELITY_LABELS[value] }))
                    ]}
                    ariaLabel="输入保真度"
                    className="settings-select"
                    onChange={(inputFidelity) => void updateActiveConversation({
                      inputFidelity: inputFidelity === '' ? null : inputFidelity
                    })}
                  />
                </label>
              ) : null}
            </div>
          </details>
          <details className="advanced-settings" key={isImage26(conversation.model) ? '26-on' : '26-off'} open={isImage26(conversation.model)}>
            <summary>
              <span>2.6 专属</span>
              <span className={`pill tiny ${isImage26(conversation.model) ? 'good' : ''}`}>
                {isImage26(conversation.model) ? '已启用' : '需要 2.6 模型'}
              </span>
            </summary>
            <div className="advanced-settings-body">
              <label className="field">
                <span className="field-label-with-help">
                  <span>复杂度 complexity</span>
                  <button
                    type="button"
                    className="info-icon"
                    title="complexity（2.6 新增）：控制画面里元素的数量与繁复程度。low 干净留白，medium 适中，high 元素密集。它不改变渲染精度，只改变画面信息量。"
                    aria-label="复杂度说明"
                  >
                    <CircleHelp size={14} />
                  </button>
                </span>
                <div className="segmented">
                  {(['low', 'medium', 'high'] as const).map((level) => (
                    <button
                      key={level}
                      className={conversation.complexity === level ? 'on' : ''}
                      onClick={() =>
                        void updateActiveConversation({
                          complexity: conversation.complexity === level ? null : level
                        })
                      }
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </label>
              <label className="field">
                <span className="field-label-with-help">
                  <span>GIF 帧数</span>
                  <button
                    type="button"
                    className="info-icon"
                    title="仅输出格式为 GIF 时生效，范围 2–64 帧。"
                    aria-label="GIF 帧数说明"
                  >
                    <CircleHelp size={14} />
                  </button>
                </span>
                <input
                  className="input-control"
                  type="number"
                  min={2}
                  max={64}
                  step={1}
                  value={conversation.frameCount ?? ''}
                  disabled={conversation.outputFormat !== 'gif'}
                  placeholder="默认 9"
                  onChange={(event) => {
                    const value = event.target.value.trim()
                    void updateActiveConversation({ frameCount: value ? Number(value) : null })
                  }}
                />
              </label>
              <label className="field">
                <span className="field-label-with-help">
                  <span>帧间隔（ms）</span>
                  <button
                    type="button"
                    className="info-icon"
                    title="仅 GIF 生效，范围 20–2000，需为 10 的倍数。"
                    aria-label="帧间隔说明"
                  >
                    <CircleHelp size={14} />
                  </button>
                </span>
                <input
                  className="input-control"
                  type="number"
                  min={20}
                  max={2000}
                  step={10}
                  value={conversation.frameDurationMs ?? ''}
                  disabled={conversation.outputFormat !== 'gif'}
                  placeholder="默认 200"
                  onChange={(event) => {
                    const value = event.target.value.trim()
                    void updateActiveConversation({ frameDurationMs: value ? Number(value) : null })
                  }}
                />
              </label>
            </div>
          </details>
          <details className="advanced-settings" open>
            <summary>
              <span>随机种子</span>
              <span className={`pill tiny ${conversation.seedLocked ? 'good' : ''}`}>
                {conversation.seedLocked ? '已锁定' : '随机'}
              </span>
            </summary>
            <div className="advanced-settings-body">
              <label className="field">
                <span className="field-label-with-help">
                  <span>seed</span>
                  <button
                    type="button"
                    className="info-icon"
                    title="锁定后可复现同一张图；留空表示每次随机。"
                    aria-label="种子说明"
                  >
                    <CircleHelp size={14} />
                  </button>
                </span>
                <div className="seed-row">
                  <input
                    className="input-control"
                    type="number"
                    min={0}
                    step={1}
                    value={conversation.seed ?? ''}
                    placeholder="随机"
                    onChange={(event) => {
                      const value = event.target.value.trim()
                      void updateActiveConversation({ seed: value ? Number(value) : null })
                    }}
                  />
                  <button
                    type="button"
                    className="seed-dice"
                    title="随机生成一个种子"
                    onClick={() => void updateActiveConversation({ seed: Math.floor(Math.random() * 1e9) })}
                  >
                    <Dices size={14} />
                  </button>
                  <button
                    type="button"
                    className={`seed-lock ${conversation.seedLocked ? 'on' : ''}`}
                    title={conversation.seedLocked ? '解锁种子' : '锁定种子'}
                    onClick={() =>
                      void updateActiveConversation({
                        seedLocked: !conversation.seedLocked,
                        seed: conversation.seedLocked ? conversation.seed : conversation.seed ?? Math.floor(Math.random() * 1e9)
                      })
                    }
                  >
                    <Lock size={14} />
                  </button>
                </div>
              </label>
            </div>
          </details>
          <ToggleRow
            label="自动写入历史"
            checked={conversation.autoSaveHistory}
            onChange={() => void updateActiveConversation({ autoSaveHistory: !conversation.autoSaveHistory })}
          />
          <ToggleRow
            label="失败详情保留"
            checked={conversation.keepFailureDetails}
            onChange={() => void updateActiveConversation({ keepFailureDetails: !conversation.keepFailureDetails })}
          />
        </section>
      </div>
    </aside>
  )
}

function ToggleRow({
  label,
  help,
  checked,
  onChange
}: {
  label: string
  help?: string
  checked: boolean
  onChange: () => void
}): JSX.Element {
  return (
    <button className="toggle-row" onClick={onChange}>
      <span className="field-label-with-help">
        <span>{label}</span>
        {help ? (
          <span className="info-icon" title={help} aria-label={`${label}说明`}>
            <CircleHelp size={14} />
          </span>
        ) : null}
      </span>
      <span className={`switch ${checked ? '' : 'off'}`} />
    </button>
  )
}
