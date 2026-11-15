import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from './app-store'

describe('focusParam', () => {
  beforeEach(() => {
    useAppStore.setState({ drawer: 'none', paramsFocus: null })
  })

  it('opens the params drawer and records the target field', () => {
    useAppStore.getState().focusParam('ratio')

    expect(useAppStore.getState().drawer).toBe('params')
    expect(useAppStore.getState().paramsFocus).toEqual({ key: 'ratio', nonce: 1 })
  })

  it('bumps nonce when the same field is clicked again', () => {
    const { focusParam } = useAppStore.getState()
    focusParam('quality')
    focusParam('quality')

    expect(useAppStore.getState().paramsFocus).toEqual({ key: 'quality', nonce: 2 })
  })

  it('switches from another drawer to the params drawer', () => {
    useAppStore.setState({ drawer: 'sessions' })
    useAppStore.getState().focusParam('format')

    expect(useAppStore.getState().drawer).toBe('params')
    expect(useAppStore.getState().paramsFocus).toEqual({ key: 'format', nonce: 1 })
  })
})
