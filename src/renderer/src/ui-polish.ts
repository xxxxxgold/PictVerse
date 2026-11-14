/**
 * 界面动效增强（配合 ui-polish.css）
 *
 * 只做三件纯表现的事，不碰业务状态：
 *  1. 指针跟随光斑：把指针相对卡片的坐标写进 --uh-mx / --uh-my，
 *     由 CSS 的 radial-gradient 画出一团跟着鼠标走的高光。
 *  2. 主按钮点击涟漪：点下去在落点扩一圈，补足「按到了」的即时反馈。
 *  3. 抽屉入场只播一次：第一次展开后打 uh-entered 标记，之后开合不再重放
 *     子元素的上浮动画（否则每次开合面板内容都会「抖一下」）。
 *
 * 全部挂 passive 监听 + rAF 节流，且尊重系统「减少动画」设置。
 */

const SPOTLIGHT_TARGETS = '.art-card, .prompt-template-card'
const RIPPLE_TARGETS = '.btn-primary, .primary, .generate-button'
const ENTER_ONCE_TARGETS = '.drawer'

const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function installPointerSpotlight(): () => void {
  // 光斑是「指针位置」的静态映射，不是动画，减少动画时也保留
  let frame = 0
  let last: PointerEvent | null = null

  const paint = () => {
    frame = 0
    const event = last
    if (!event) return
    const target = event.target
    if (!(target instanceof Element)) return
    const card = target.closest(SPOTLIGHT_TARGETS)
    if (!(card instanceof HTMLElement)) return
    const rect = card.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    card.style.setProperty('--uh-mx', `${Math.round(event.clientX - rect.left)}px`)
    card.style.setProperty('--uh-my', `${Math.round(event.clientY - rect.top)}px`)
  }

  const onMove = (event: PointerEvent) => {
    last = event
    if (!frame) frame = requestAnimationFrame(paint)
  }

  window.addEventListener('pointermove', onMove, { passive: true })
  return () => {
    window.removeEventListener('pointermove', onMove)
    if (frame) cancelAnimationFrame(frame)
  }
}

export function installButtonRipple(): () => void {
  if (prefersReducedMotion()) return () => {}

  const onClick = (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const button = target.closest(RIPPLE_TARGETS)
    if (!(button instanceof HTMLElement) || button.hasAttribute('disabled')) return
    const rect = button.getBoundingClientRect()
    if (!rect.width || !rect.height) return

    const ripple = document.createElement('span')
    ripple.className = 'uh-ripple'
    const size = Math.max(rect.width, rect.height) * 1.1
    ripple.style.width = `${size}px`
    ripple.style.height = `${size}px`
    ripple.style.left = `${event.clientX - rect.left - size / 2}px`
    ripple.style.top = `${event.clientY - rect.top - size / 2}px`
    // 动画结束自删；动画被降级时靠 setTimeout 兜底
    ripple.addEventListener('animationend', () => ripple.remove(), { once: true })
    window.setTimeout(() => ripple.remove(), 900)
    button.appendChild(ripple)
  }

  document.addEventListener('click', onClick, true)
  return () => document.removeEventListener('click', onClick, true)
}

/** 抽屉入场动画只播一次：首次展开动画播完就写下标记，之后 .open 不再触发子元素上浮 */
export function installDrawerEnterOnce(): () => void {
  const ENTERED_ATTR = 'data-uh-entered'

  const mark = () => {
    for (const drawer of document.querySelectorAll<HTMLElement>(ENTER_ONCE_TARGETS)) {
      if (!drawer.classList.contains('open')) continue
      if (drawer.dataset.uhEntered === '1') continue
      // 等首次入场动画播完再写标记，避免首帧就被抑制
      window.setTimeout(() => {
        // 期间可能已经关掉，这里只要求它曾经打开过
        drawer.dataset.uhEntered = '1'
      }, 480)
    }
  }

  const observer = new MutationObserver(mark)
  const bind = () => {
    for (const drawer of document.querySelectorAll(ENTER_ONCE_TARGETS)) {
      if (drawer.getAttribute(ENTERED_ATTR) === '1') continue
      if ((drawer as HTMLElement & { __uhBound?: boolean }).__uhBound) continue
      ;(drawer as HTMLElement & { __uhBound?: boolean }).__uhBound = true
      observer.observe(drawer, { attributes: true, attributeFilter: ['class'] })
    }
  }

  bind()
  // 抽屉可能是后挂载的：观察文档结构变化，补挂新节点
  const bodyObserver = new MutationObserver(() => {
    bind()
    mark()
  })
  bodyObserver.observe(document.body, { childList: true, subtree: true })
  // 首帧就处于打开状态的场景
  mark()

  return () => {
    observer.disconnect()
    bodyObserver.disconnect()
  }
}

export function installUiPolish(): () => void {
  const disposers = [installPointerSpotlight(), installButtonRipple(), installDrawerEnterOnce()]
  return () => disposers.forEach((dispose) => dispose())
}
