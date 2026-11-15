import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from './app-store'

describe('generate 前置守卫', () => {
  const originalWindow = globalThis.window

  afterEach(() => {
    useAppStore.setState({ conversations: [], activeConversationId: null, toast: null })
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true
    })
    vi.restoreAllMocks()
  })

  it('没有激活会话时给出可见提示，而不是静默返回', async () => {
    const generate = vi.fn()
    Object.defineProperty(globalThis, 'window', {
      value: {
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout,
        pictverse: { image: { generate } }
      },
      configurable: true
    })
    useAppStore.setState({ conversations: [], activeConversationId: null, toast: null })

    await useAppStore.getState().generate()

    expect(useAppStore.getState().toast).toBe('请先选择或新建一个会话')
    expect(generate).not.toHaveBeenCalled()
  })
})
