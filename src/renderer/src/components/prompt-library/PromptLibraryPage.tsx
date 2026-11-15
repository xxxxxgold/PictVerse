import { useEffect, useMemo, useState, type JSX } from 'react'
import { BookOpen, Copy, PencilLine, Plus, RotateCcw, Search, Trash2, Wand2 } from 'lucide-react'
import { GallerySelect, type GallerySelectOption } from '@renderer/components/gallery/GallerySelect'
import {
  PROMPT_TEMPLATE_ANY_MODEL,
  clonePromptTemplate,
  createEmptyPromptTemplateInput,
  createPromptLibraryItem,
  deletePromptLibraryItem,
  filterPromptTemplates,
  getPromptLibraryItems,
  getPromptTemplateCategories,
  getPromptTemplateModels,
  type PromptLibraryItem,
  type PromptTemplate,
  type PromptTemplateInput,
  updatePromptLibraryItem
} from '@renderer/prompt-library'
import { IMAGE_QUALITIES_EXTENDED, IMAGE_RATIOS, formatImageQuality } from '@shared/image-options'
import { resolveActiveProvider } from '@shared/provider-selection'
import { useAppStore } from '@renderer/store/app-store'
import { PromptTemplateEditorModal } from './PromptTemplateEditorModal'

const ratioOptions: Array<GallerySelectOption<'all' | PromptTemplate['ratio']>> = [
  { value: 'all', label: '比例' },
  ...IMAGE_RATIOS.map((ratio) => ({ value: ratio, label: ratio }))
]

const qualityOptions: Array<GallerySelectOption<'all' | PromptTemplate['quality']>> = [
  { value: 'all', label: '质量' },
  ...IMAGE_QUALITIES_EXTENDED.map((quality) => ({ value: quality, label: formatImageQuality(quality) }))
]

const FOLLOW_CONVERSATION_LABEL = '跟随会话'

const pageSizeOptions = [10, 15, 20, 30, 50, 100]

export function PromptLibraryPage(): JSX.Element {
  const { notify, applyPromptTemplate, providers, conversations, activeConversationId } = useAppStore()
  const [items, setItems] = useState<PromptLibraryItem[]>(() => getPromptLibraryItems())
  const [searchQuery, setSearchQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [ratio, setRatio] = useState<'all' | PromptTemplate['ratio']>('all')
  const [quality, setQuality] = useState<'all' | PromptTemplate['quality']>('all')
  const [model, setModel] = useState<'all' | string>('all')
  const [editingTemplate, setEditingTemplate] = useState<PromptLibraryEditorState | null>(null)
  const [providerModels, setProviderModels] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(15)

  const activeProviderId = useMemo(() => {
    const conversation = conversations.find((item) => item.id === activeConversationId) || null
    return resolveActiveProvider(conversation?.providerId, providers)?.id ?? null
  }, [activeConversationId, conversations, providers])

  useEffect(() => {
    if (!activeProviderId) {
      setProviderModels([])
      return
    }
    let cancelled = false
    void window.pictverse.provider
      .models(activeProviderId)
      .then((rows) => {
        if (!cancelled) setProviderModels(rows.map((row) => row.modelId))
      })
      .catch(() => {
        if (!cancelled) setProviderModels([])
      })
    return () => {
      cancelled = true
    }
  }, [activeProviderId])

  const categories = useMemo(() => getPromptTemplateCategories(items), [items])
  const tagOptions = useMemo(
    () =>
      Array.from(new Set(items.flatMap((item) => item.tags.map((tag) => tag.trim()).filter(Boolean))))
        .sort((left, right) => left.localeCompare(right, 'zh-Hans-CN')),
    [items]
  )
  const categoryOptions = useMemo(
    () => categories.map((value) => ({ value, label: value })),
    [categories]
  )

  /** 候选模型：供应商已保存的模型 + 模板里出现过的模型，去重排序 */
  const modelChoices = useMemo(
    () =>
      Array.from(new Set([...providerModels, ...getPromptTemplateModels(items)].map((value) => value.trim()).filter(Boolean)))
        .sort((left, right) => left.localeCompare(right)),
    [items, providerModels]
  )

  const modelFilterOptions = useMemo<Array<GallerySelectOption<string>>>(() => {
    const options: Array<GallerySelectOption<string>> = [
      { value: 'all', label: '模型' },
      { value: PROMPT_TEMPLATE_ANY_MODEL, label: FOLLOW_CONVERSATION_LABEL },
      ...modelChoices.map((value) => ({ value, label: value }))
    ]
    // 筛选值已不在候选里（例如模板被改掉）时补一个占位项，避免下拉显示为空
    if (model !== 'all' && !options.some((option) => option.value === model)) {
      options.push({ value: model, label: model })
    }
    return options
  }, [model, modelChoices])

  const templates = useMemo(
    () => filterPromptTemplates(items, { query: searchQuery, category, ratio, quality, model }),
    [category, items, model, quality, ratio, searchQuery]
  )

  const pageCount = Math.max(1, Math.ceil(templates.length / pageSize))
  const pageItems = useMemo(
    () => templates.slice((page - 1) * pageSize, page * pageSize),
    [page, pageSize, templates]
  )

  // 数据变化（筛选/搜索/增删）导致页数收缩时钳回最后一页；筛选条件变化时回第 1 页
  useEffect(() => {
    setPage((current) => Math.min(current, pageCount))
  }, [pageCount])

  useEffect(() => {
    setPage(1)
  }, [searchQuery, category, ratio, quality, model, pageSize])

  const refreshItems = () => setItems(getPromptLibraryItems())

  const resetFilters = () => {
    setCategory('all')
    setRatio('all')
    setQuality('all')
    setModel('all')
    setSearchQuery('')
  }

  const copyPrompt = async (template: PromptTemplate) => {
    try {
      await navigator.clipboard.writeText(template.prompt)
      notify('已复制提示词')
    } catch (error) {
      notify(error instanceof Error ? `复制失败：${error.message}` : '复制失败')
    }
  }

  const handleApply = async (template: PromptTemplate) => {
    await applyPromptTemplate(template)
  }

  const handleCreate = () => {
    setEditingTemplate({
      id: null,
      title: '新增提示词',
      initialValue: createEmptyPromptTemplateInput()
    })
  }

  const handleEditTemplate = (template: PromptLibraryItem) => {
    setEditingTemplate({
      id: template.id,
      title: '编辑提示词',
      initialValue: clonePromptTemplate(template)
    })
  }

  const handleDeleteTemplate = (template: PromptTemplate) => {
    if (!window.confirm(`确认删除「${template.title}」吗？`)) return
    deletePromptLibraryItem(template.id)
    refreshItems()
    notify('已删除提示词')
  }

  return (
    <section className="prompt-library-page">
      <div className="prompt-library-hero">
        <div>
          <h2>提示词库</h2>
          <p>支持新增、编辑、删除提示词模板，并可一键套用到当前会话。</p>
        </div>
        <div className="prompt-library-summary">
          <span className="summary-chip total">
            <BookOpen size={13} />
            <strong>{templates.length}</strong>
            条
          </span>
        </div>
      </div>

      <div className="gallery-tools prompt-library-tools">
        <div className="search-wrap">
          <Search size={16} />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索标题、标签、说明、提示词、分辨率或模型"
          />
        </div>
        <GallerySelect value={category} options={[{ value: 'all', label: '分类' }, ...categoryOptions]} ariaLabel="筛选分类" onChange={setCategory} />
        <GallerySelect value={ratio} options={ratioOptions} ariaLabel="筛选比例" onChange={setRatio} />
        <GallerySelect value={quality} options={qualityOptions} ariaLabel="筛选质量" onChange={setQuality} />
        <GallerySelect value={model} options={modelFilterOptions} ariaLabel="筛选生图模型" className="prompt-library-model-filter" onChange={setModel} />
        <button onClick={resetFilters}>
          <RotateCcw size={15} />
          重置
        </button>
        <button className="primary" onClick={handleCreate}>
          <Plus size={15} />
          新增
        </button>
      </div>

      <div className="prompt-library-grid">
        {pageItems.length === 0 ? <div className="empty-state grid-empty">暂无匹配模板</div> : null}
        {pageItems.map((template) => (
          <article
            key={template.id}
            className="prompt-template-card"
            role="button"
            tabIndex={0}
            onClick={() => handleEditTemplate(template)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                handleEditTemplate(template)
              }
            }}
          >
            <div className="prompt-template-card-head">
              <div>
                <h3>{template.title}</h3>
                <p>{template.description || '暂无说明'}</p>
              </div>
              <div className="prompt-template-card-badges">
                <span className="pill good">{template.category}</span>
                <span className="pill blue">{template.resolution}</span>
                <span className="pill">{template.quality}</span>
                {template.model ? (
                  <span className="pill model" title={`生图模型：${template.model}`}>
                    {template.model}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="prompt-template-tags">
              {template.tags.map((tag) => (
                <span key={tag} className="pill">
                  {tag}
                </span>
              ))}
            </div>
            <div className="prompt-template-card-actions">
              <button
                type="button"
                className="primary"
                title="套用"
                aria-label="套用"
                onClick={(event) => {
                  event.stopPropagation()
                  void handleApply(template)
                }}
              >
                <Wand2 size={14} />
              </button>
              <button
                type="button"
                title="复制"
                aria-label="复制"
                onClick={(event) => {
                  event.stopPropagation()
                  void copyPrompt(template)
                }}
              >
                <Copy size={14} />
              </button>
              <button
                type="button"
                title="编辑"
                aria-label="编辑"
                onClick={(event) => {
                  event.stopPropagation()
                  handleEditTemplate(template)
                }}
              >
                <PencilLine size={14} />
              </button>
              <button
                type="button"
                className="danger"
                title="删除"
                aria-label="删除"
                onClick={(event) => {
                  event.stopPropagation()
                  handleDeleteTemplate(template)
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </article>
        ))}
      </div>

      {templates.length > 0 ? (
        <div className="gallery-pagination prompt-library-pagination">
          <button disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
            上一页
          </button>
          <span>
            {page} / {pageCount}
          </span>
          <button disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>
            下一页
          </button>
          <GallerySelect
            value={pageSize}
            options={pageSizeOptions.map((value) => ({ value, label: `${value} 条/页` }))}
            ariaLabel="每页数量"
            className="page-size-select"
            onChange={setPageSize}
          />
        </div>
      ) : null}

      {editingTemplate ? (
        <PromptTemplateEditorModal
          title={editingTemplate.title}
          initialValue={editingTemplate.initialValue}
          categoryOptions={categories}
          tagOptions={tagOptions}
          modelOptions={modelChoices}
          onSave={async (value) => {
            const normalized = normalizeLibraryInput(value)
            if (editingTemplate.id) {
              updatePromptLibraryItem(editingTemplate.id, normalized)
            } else {
              createPromptLibraryItem(normalized)
            }
            refreshItems()
            setEditingTemplate(null)
            notify(editingTemplate.id ? '已保存提示词' : '已新增提示词')
          }}
          onClose={() => setEditingTemplate(null)}
        />
      ) : null}
    </section>
  )
}

type PromptLibraryEditorState = {
  id: string | null
  title: string
  initialValue: PromptTemplateInput
}

function normalizeLibraryInput(value: PromptTemplateInput): PromptTemplateInput {
  return {
    ...value,
    title: value.title.trim(),
    category: value.category.trim(),
    description: value.description.trim(),
    prompt: value.prompt.trim(),
    resolution: value.resolution.trim(),
    model: value.model.trim(),
    tags: value.tags.map((tag) => tag.trim()).filter(Boolean)
  }
}
