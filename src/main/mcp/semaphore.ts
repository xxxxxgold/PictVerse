/**
 * 生成并发闸门。
 *
 * 为什么要它：MCP 把生成能力交给了外部 agent，agent 一旦写个循环就会在极短时间内
 * 打出几十个请求，上游按图计费、也容易触发限流。这里做的是**稳定性护栏**，
 * 不是权限控制——超过上限直接给出可读错误，不排队、不静默丢弃。
 */
export class Semaphore {
  private active = 0
  private readonly waiters: Array<() => void> = []

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Semaphore limit must be a positive integer.')
  }

  get inFlight(): number {
    return this.active
  }

  get maxConcurrent(): number {
    return this.limit
  }

  /**
   * 不排队版本：拿不到立即失败。
   * 生成场景用户/agent 都能马上重试，排队反而让「看起来卡住」更不可控。
   */
  tryAcquire(): (() => void) | null {
    if (this.active >= this.limit) return null
    this.active += 1
    let released = false
    return () => {
      // 重复 release 不能让计数变成负数
      if (released) return
      released = true
      this.active -= 1
      const next = this.waiters.shift()
      if (next) next()
    }
  }

  async acquire(): Promise<() => void> {
    const immediate = this.tryAcquire()
    if (immediate) return immediate
    await new Promise<void>((resolve) => this.waiters.push(resolve))
    // 被唤醒时名额已经由上一位释放者转交，这里不再自增
    let released = false
    return () => {
      if (released) return
      released = true
      this.active -= 1
      const next = this.waiters.shift()
      if (next) next()
    }
  }
}
