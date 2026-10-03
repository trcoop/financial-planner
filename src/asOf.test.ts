import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => vi.useRealTimers())

describe('systemAsOf', () => {
  it('month is 1-based and the clock is read once (cached)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2027, 0, 5)) // January
    vi.resetModules()
    const { systemAsOf } = await import('./asOf')
    expect(systemAsOf()).toEqual({ year: 2027, month: 1 })
    vi.setSystemTime(new Date(2030, 11, 31))
    expect(systemAsOf()).toEqual({ year: 2027, month: 1 })
  })
})
