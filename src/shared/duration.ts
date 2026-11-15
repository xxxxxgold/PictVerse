export function elapsedMs(startedAtMs: number, nowMs: number = Date.now()): number {
  return Math.max(0, nowMs - startedAtMs)
}

export function formatDuration(ms: number): string {
  // 脏数据（NaN/Infinity）不应显示成 "NaNm NaNs"：按 0 处理
  const safe = Number.isFinite(ms) ? Math.max(0, ms) : 0
  const totalSeconds = Math.floor(safe / 1000)

  if (totalSeconds < 60) {
    return `${totalSeconds}s`
  }

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds - minutes * 60
  return `${minutes}m ${seconds}s`
}
