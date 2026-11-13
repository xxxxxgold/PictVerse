import type { Provider } from './types'

/**
 * 会话实际生效的供应商：会话指定 → 默认供应商 → 第一个供应商 → null。
 *
 * 全仓库唯一定义。此前 UI 四处分头实现这段回落、数据层没实现，
 * 导致「界面按 A 供应商算能力、落盘判定按 null 算」的口径分裂。
 * 任何需要「这个会话用的是哪个供应商」的地方都必须调用这里。
 */
export function resolveActiveProvider(
  providerId: string | null | undefined,
  providers: Provider[]
): Provider | null {
  if (providers.length === 0) return null
  return (
    (providerId ? providers.find((item) => item.id === providerId) : undefined)
    ?? providers.find((item) => item.isDefault)
    ?? providers[0]
    ?? null
  )
}
