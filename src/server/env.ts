import { DEFAULT_MODEL } from '../shared/image-options'
import { DEFAULT_PROMPT_MODEL } from '../shared/prompt-options'

export type ServerEnv = {
  port: number
  baseURL: string
  apiKey: string
  imageModel: string
  promptModel: string
  enableImageEdit: boolean
  enablePromptAssist: boolean
  maxImageCount: number
  maxConcurrentRequests: number
  requestTimeoutMs: number
}

export function loadEnv(): ServerEnv {
  return {
    port: toInteger(process.env.PICTVERSE_PORT, 3000, 1, 65535),
    baseURL: (process.env.PICTVERSE_BASE_URL || 'https://api.openai.com').replace(/\/+$/, ''),
    apiKey: process.env.PICTVERSE_API_KEY || '',
    imageModel: process.env.PICTVERSE_IMAGE_MODEL || DEFAULT_MODEL,
    promptModel: process.env.PICTVERSE_PROMPT_MODEL || DEFAULT_PROMPT_MODEL,
    enableImageEdit: toBoolean(process.env.PICTVERSE_ENABLE_IMAGE_EDIT, true),
    enablePromptAssist: toBoolean(process.env.PICTVERSE_ENABLE_PROMPT_ASSIST, true),
    maxImageCount: toInteger(process.env.PICTVERSE_MAX_IMAGE_COUNT, 4, 1, 10),
    maxConcurrentRequests: toInteger(process.env.PICTVERSE_MAX_CONCURRENT_REQUESTS, 5, 1, 100),
    requestTimeoutMs: toInteger(process.env.PICTVERSE_REQUEST_TIMEOUT_MS, 300000, 1000, 900000)
  }
}

function toBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function toInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(parsed)))
}
