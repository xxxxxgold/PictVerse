import { describe, expect, it } from 'vitest'
import { DEFAULT_PROMPT_ASSIST_CONFIG, isAssistantModelChosen } from './prompt-assistant'

/** 用户 2026-11-15 反馈的真实候选：luluai.win 返回的模型里没有 gpt-6.1-sol */
const LULUAI_MODELS = ['gpt-image-2', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'gpt-image-2.6-flare', 'gpt-image-2.6-sunburst']

describe('isAssistantModelChosen', () => {
  it('treats the builtin default model as not chosen when candidates do not contain it', () => {
    // 这正是用户看到的问题：框里显示 gpt-6.1-sol，但服务端从没返回过它
    expect(isAssistantModelChosen(DEFAULT_PROMPT_ASSIST_CONFIG.model, LULUAI_MODELS, false)).toBe(false)
  })

  it('treats the builtin default model as chosen when the service really lists it', () => {
    const models = [...LULUAI_MODELS, DEFAULT_PROMPT_ASSIST_CONFIG.model]
    expect(isAssistantModelChosen(DEFAULT_PROMPT_ASSIST_CONFIG.model, models, false)).toBe(true)
  })

  it('matches candidate model ids case-insensitively', () => {
    expect(isAssistantModelChosen('GPT-6.1-SOL', ['gpt-6.1-sol'], false)).toBe(true)
  })

  it('respects an explicit user edit even when candidates are empty', () => {
    expect(isAssistantModelChosen('gpt-image-2', [], true)).toBe(true)
  })

  it('treats a non-default value as chosen even before fetching candidates', () => {
    expect(isAssistantModelChosen('gpt-image-2', [], false)).toBe(true)
  })

  it('treats empty and whitespace values as not chosen', () => {
    expect(isAssistantModelChosen('', LULUAI_MODELS, false)).toBe(false)
    expect(isAssistantModelChosen('   ', LULUAI_MODELS, true)).toBe(false)
    expect(isAssistantModelChosen(null, LULUAI_MODELS, true)).toBe(false)
    expect(isAssistantModelChosen(undefined, LULUAI_MODELS, false)).toBe(false)
  })
})
