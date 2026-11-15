import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from './app-store'

/**
 * 回归：toast 定时器必须被清理。
 * 之前的实现每次 notify 都新开一个 setTimeout 却从不 clear，
 * 于是「短提示」的旧定时器会提前清掉后到的「长提示」。
 */
describe('notify toast timer', () => {
  const originalWindow = globalThis.window

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true })
    useAppStore.setState({ toast: null })
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('keeps the newer long toast alive after the older short timer fires', () => {
    vi.useFakeTimers()
    Object.defineProperty(globalThis, 'window', {
      value: {
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout,
        clearInterval: globalThis.clearInterval,
        pictverse: {}
      },
      configurable: true
    })
    useAppStore.setState({ toast: null })

    // t=0：短提示，1800ms 后消失
    useAppStore.getState().notify('短提示', 1800)
    expect(useAppStore.getState().toast).toBe('短提示')

    // t=300：长提示，6000ms 后消失
    vi.advanceTimersByTime(300)
    useAppStore.getState().notify('长提示', 6000)
    expect(useAppStore.getState().toast).toBe('长提示')

    // 走到 t=1800：旧实现会在这里把长提示清掉
    vi.advanceTimersByTime(1500)
    expect(useAppStore.getState().toast).toBe('长提示')

    // 走到 t=6300：长提示自己的定时器才该生效
    vi.advanceTimersByTime(4600)
    expect(useAppStore.getState().toast).toBe(null)
  })

  it('clears the pending timer when notify is called with null', () => {
    vi.useFakeTimers()
    Object.defineProperty(globalThis, 'window', {
      value: {
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout,
        clearInterval: globalThis.clearInterval,
        pictverse: {}
      },
      configurable: true
    })
    useAppStore.setState({ toast: null })

    useAppStore.getState().notify('提示', 6000)
    useAppStore.getState().notify(null)
    expect(useAppStore.getState().toast).toBe(null)

    // 之前那个 6000ms 的定时器已被清掉，不应在 6s 后再触发状态变更
    vi.advanceTimersByTime(7000)
    expect(useAppStore.getState().toast).toBe(null)
  })
})
