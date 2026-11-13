import { useEffect, type JSX } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useAppStore } from '@renderer/store/app-store'
import { GalleryPage } from '@renderer/components/gallery/GalleryPage'
import { PromptLibraryPage } from '@renderer/components/prompt-library/PromptLibraryPage'
import { SettingsPanel } from '@renderer/components/settings/SettingsPanel'
import { Sidebar } from '@renderer/components/sidebar/Sidebar'
import { Workspace } from '@renderer/components/workspace/Workspace'

export function MainLayout({
  activeConversationGenerating,
  activeConversationStartedAt,
  generationClockMs
}: {
  activeConversationGenerating: boolean
  activeConversationStartedAt: number | null
  generationClockMs: number
}): JSX.Element {
  const { view, drawer, toggleSessionsDrawer, toggleParamsDrawer, setDrawer } = useAppStore()

  // 抽屉打开时，点击抽屉外的任意位置或按下 Esc 都会收起
  useEffect(() => {
    if (drawer === 'none') return

    const handlePointerDown = (event: PointerEvent) => {
      // 弹窗打开时让弹窗自己处理，避免误收抽屉
      if (document.querySelector('.modal.open')) return
      // 抽屉内部、边缘把手都不算「外面」
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('.drawer, .edge-handle')) return
      setDrawer('none')
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (document.querySelector('.modal.open')) return
      setDrawer('none')
    }

    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [drawer, setDrawer])

  return (
    <main className={`main drawer-${drawer}`}>
      <div className="stage">
        <button
          className="edge-handle left"
          title={drawer === 'sessions' ? '收起会话' : '展开会话'}
          onClick={toggleSessionsDrawer}
        >
          <ChevronRight size={15} />
        </button>

        <aside className={`drawer left ${drawer === 'sessions' ? 'open' : ''}`}>
          <Sidebar />
        </aside>

        <div className="canvas-wrap">
          {view === 'gallery' ? (
            <GalleryPage />
          ) : view === 'prompts' ? (
            <PromptLibraryPage />
          ) : (
            <Workspace
              activeConversationGenerating={activeConversationGenerating}
              activeConversationStartedAt={activeConversationStartedAt}
              generationClockMs={generationClockMs}
            />
          )}
        </div>

        <button
          className="edge-handle right"
          title={drawer === 'params' ? '收起参数' : '展开参数'}
          onClick={toggleParamsDrawer}
        >
          <ChevronLeft size={15} />
        </button>

        <aside className={`drawer right ${drawer === 'params' ? 'open' : ''}`}>
          <SettingsPanel />
        </aside>
      </div>
    </main>
  )
}
