import { describe, expect, it } from 'vitest'
import { Semaphore } from './semaphore'

describe('生成并发闸门', () => {
  it('到上限后拒绝而不是排队', () => {
    const semaphore = new Semaphore(2)
    const first = semaphore.tryAcquire()
    const second = semaphore.tryAcquire()
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(semaphore.inFlight).toBe(2)
    expect(semaphore.tryAcquire()).toBeNull()
  })

  it('释放后可以再次进入，且重复释放不会把计数打穿', () => {
    const semaphore = new Semaphore(1)
    const release = semaphore.tryAcquire()
    expect(release).not.toBeNull()
    release!()
    release!()
    expect(semaphore.inFlight).toBe(0)
    expect(semaphore.tryAcquire()).not.toBeNull()
  })

  it('上限参数必须为正整数', () => {
    expect(() => new Semaphore(0)).toThrow()
    expect(() => new Semaphore(1.5)).toThrow()
  })

  it('acquire 在有空位时立即返回', async () => {
    const semaphore = new Semaphore(1)
    const release = await semaphore.acquire()
    expect(semaphore.inFlight).toBe(1)
    release()
    expect(semaphore.inFlight).toBe(0)
  })
})
