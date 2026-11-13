import type { Provider } from '@shared/types'

/**
 * 从供应商的 `/v1/models` 拉取可用模型 ID。
 * 大多数 OpenAI 兼容服务会返回 `{ data: [{ id }] }`，也兼容直接返回数组的形式。
 */
export async function fetchProviderModels(provider: Provider): Promise<string[]> {
  const base = provider.baseURL.trim().replace(/\/+$/, '')
  if (!base) throw new Error('供应商未配置 Base URL。')

  const url = `${base}/v1/models`
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`

  const response = await fetch(url, { headers })
  if (!response.ok) {
    throw new Error(`获取模型失败：HTTP ${response.status} ${response.statusText}`)
  }

  const payload: unknown = await response.json()
  const ids = extractModelIds(payload)
  if (ids.length === 0) throw new Error('供应商没有返回任何模型。')
  return ids
}

function extractModelIds(payload: unknown): string[] {
  if (Array.isArray(payload)) {
    return payload.map(readModelId).filter((id): id is string => Boolean(id))
  }
  if (payload && typeof payload === 'object') {
    const data = (payload as { data?: unknown }).data
    if (Array.isArray(data)) {
      return data.map(readModelId).filter((id): id is string => Boolean(id))
    }
  }
  return []
}

function readModelId(entry: unknown): string | null {
  if (typeof entry === 'string') return entry
  if (entry && typeof entry === 'object') {
    const id = (entry as { id?: unknown }).id
    if (typeof id === 'string' && id.trim()) return id.trim()
  }
  return null
}
