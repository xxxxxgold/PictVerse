/**
 * 界面动效增强（配合 ui-polish.css）
 *
 * 只做两件纯表现的事，不碰业务状态：
 *  1. 指针跟随光斑：把指针相对卡片的坐标写进 --uh-mx / --uh-my，
 *     由 CSS 的 radial-gradient 画出一团跟着鼠标走的高光。
 *  2. 主按钮点击涟漪：点下去在落点扩一圈，补足「按到了」的即时反馈。
 *
 * 全部挂 passive 监听 + rAF 节流，且尊重系统「减少动画」设置。
 */

const SPOTLIGHT_TARGETS = '.art-card, .prompt-template-card'
const RIPPLE_TARGETS = '.btn-primary, .primary, .generate-button'

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

export function installUiPolish(): () => void {
  const disposers = [installPointerSpotlight(), installButtonRipple()]
  return () => disposers.forEach((dispose) => dispose())
}
