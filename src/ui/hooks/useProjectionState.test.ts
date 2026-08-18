import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useProjectionState } from './useProjectionState'
import type { AdvancedAssumptionValues, CoreInputValues } from '../components'

const CORE: CoreInputValues = {
  currentAge: 35,
  retirementAge: 67,
  initialBalance: 250000,
  currentAnnualIncome: 85000,
  annualContributionRatePercent: 15,
}

const ADVANCED: AdvancedAssumptionValues = {
  annualRaisePercent: 3,
  annualReturnPercent: 7,
  inflationPercent: 2.5,
  withdrawalRatePercent: 4,
  stocksAllocationPercent: 70,
}

const DEBOUNCE_MS = 300

describe('useProjectionState', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('computes rows and projectedBalanceAtRetirement from the initial values', () => {
    const { result } = renderHook(() => useProjectionState(CORE, ADVANCED, DEBOUNCE_MS))

    expect(result.current.error).toBeUndefined()
    expect(result.current.rows.length).toBeGreaterThan(0)
    const retirementRow = result.current.rows.find((row) => row.age >= CORE.retirementAge)
    expect(retirementRow).toBeDefined()
    expect(result.current.projectedBalanceAtRetirement).toBe(retirementRow!.endingBalance)
  })

  it('exposes the debounced core/advanced values used for the projection, settled to the initial values on first render', () => {
    const { result } = renderHook(() => useProjectionState(CORE, ADVANCED, DEBOUNCE_MS))

    expect(result.current.debouncedCore).toEqual(CORE)
    expect(result.current.debouncedAdvanced).toEqual(ADVANCED)
  })

  it('debouncedCore/debouncedAdvanced only update after the debounce delay elapses, mirroring rows', () => {
    const { result, rerender } = renderHook(
      ({ core }) => useProjectionState(core, ADVANCED, DEBOUNCE_MS),
      { initialProps: { core: CORE } },
    )
    const changedCore = { ...CORE, currentAge: 60 }

    rerender({ core: changedCore })
    expect(result.current.debouncedCore).toEqual(CORE)

    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS)
    })
    expect(result.current.debouncedCore).toEqual(changedCore)
  })

  it('does not recompute before the debounce delay elapses', () => {
    const { result, rerender } = renderHook(
      ({ core }) => useProjectionState(core, ADVANCED, DEBOUNCE_MS),
      { initialProps: { core: CORE } },
    )
    const before = result.current.rows

    rerender({ core: { ...CORE, currentAge: 60 } })
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS - 1)
    })

    expect(result.current.rows).toBe(before)
  })

  it('recomputes after the debounce delay elapses', () => {
    const { result, rerender } = renderHook(
      ({ core }) => useProjectionState(core, ADVANCED, DEBOUNCE_MS),
      { initialProps: { core: CORE } },
    )
    const before = result.current.rows

    rerender({ core: { ...CORE, currentAge: 60 } })
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS)
    })

    expect(result.current.rows).not.toBe(before)
    expect(result.current.rows[0].age).toBe(60)
  })

  it('debounces advancedValues changes too, not just coreValues', () => {
    const { result, rerender } = renderHook(
      ({ advanced }) => useProjectionState(CORE, advanced, DEBOUNCE_MS),
      { initialProps: { advanced: ADVANCED } },
    )
    const before = result.current.rows

    rerender({ advanced: { ...ADVANCED, annualReturnPercent: 2 } })
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS - 1)
    })
    expect(result.current.rows).toBe(before)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.rows).not.toBe(before)
  })

  it('pauses on out-of-range input, keeping the last valid rows/balance and no error (FIN-9 AC)', () => {
    const { result, rerender } = renderHook(
      ({ core }) => useProjectionState(core, ADVANCED, DEBOUNCE_MS),
      { initialProps: { core: CORE } },
    )
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS)
    })
    const lastGoodRows = result.current.rows
    const lastGoodBalance = result.current.projectedBalanceAtRetirement

    // currentAge above its enforced range (18-100) fails isCoreInputValid, so the hook must
    // pause rather than run the engine at all.
    rerender({ core: { ...CORE, currentAge: 9_000_000 } })
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS)
    })

    expect(result.current.error).toBeUndefined()
    expect(result.current.rows).toBe(lastGoodRows)
    expect(result.current.projectedBalanceAtRetirement).toBe(lastGoodBalance)
  })

  it('resumes normal computation once the out-of-range input is corrected', () => {
    const { result, rerender } = renderHook(
      ({ core }) => useProjectionState(core, ADVANCED, DEBOUNCE_MS),
      { initialProps: { core: CORE } },
    )
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS)
    })

    rerender({ core: { ...CORE, currentAge: 9_000_000 } })
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS)
    })
    const pausedRows = result.current.rows

    rerender({ core: { ...CORE, currentAge: 40 } })
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS)
    })

    expect(result.current.error).toBeUndefined()
    expect(result.current.rows).not.toBe(pausedRows)
    expect(result.current.rows[0].age).toBe(40)
  })

  it('surfaces an engine error (InvalidProjectionInputError) when a value passes form-level range validation but fails engine validation', () => {
    // NaN slips past isCoreInputValid: `NaN < min` and `NaN > max` are both false, so
    // rangeError sees no violation. The engine's own finiteness check (NON_FINITE_INPUT)
    // then rejects it — this exercises the hook's try/catch branch, distinct from the
    // form-level "pause" path covered above.
    const core: CoreInputValues = { ...CORE, currentAge: Number.NaN }
    const { result } = renderHook(() => useProjectionState(core, ADVANCED, DEBOUNCE_MS))
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS)
    })

    expect(result.current.error).toBeDefined()
    expect(result.current.rows).toEqual([])
    expect(result.current.projectedBalanceAtRetirement).toBeUndefined()
  })

  it('picks the earliest row at/after retirementAge, not the last matching row (retirement-year balance, not final-year balance)', () => {
    // currentAge 35, retirementAge 67: many rows satisfy `age >= 67` (67 through 100).
    // projectedBalanceAtRetirement must be the *retirement-year* row's balance, not
    // whatever the final row (age 100) happens to hold.
    const { result } = renderHook(() => useProjectionState(CORE, ADVANCED, DEBOUNCE_MS))

    const retirementRow = result.current.rows.find((row) => row.age === CORE.retirementAge)
    const finalRow = result.current.rows.at(-1)
    expect(retirementRow).toBeDefined()
    expect(retirementRow?.age).not.toBe(finalRow?.age)
    expect(result.current.projectedBalanceAtRetirement).toBe(retirementRow?.endingBalance)
    expect(result.current.projectedBalanceAtRetirement).not.toBe(finalRow?.endingBalance)
  })

  it('falls back to the last row ending balance when rows are non-empty but none reach retirementAge', () => {
    // The retirement-row lookup uses the *current* (possibly-invalid) debounced retirementAge
    // against whatever `rows` currently holds — including frozen rows from a prior valid
    // computation while paused. Get a valid, non-empty result first, then push retirementAge
    // out of isCoreInputValid's range (which pauses, freezing `rows`) far past every frozen
    // row's age, so `.find` genuinely comes back empty on a *non-empty* rows array and the
    // `.at(-1)` fallback — not the "no prior result" empty-array case — is what's exercised.
    const { result, rerender } = renderHook(
      ({ core }) => useProjectionState(core, ADVANCED, DEBOUNCE_MS),
      { initialProps: { core: CORE } },
    )
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS)
    })
    const frozenRows = result.current.rows
    expect(frozenRows.length).toBeGreaterThan(0)

    rerender({ core: { ...CORE, retirementAge: 9_000_000 } })
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS)
    })

    expect(result.current.rows).toBe(frozenRows)
    const retirementRow = result.current.rows.find((row) => row.age >= 9_000_000)
    expect(retirementRow).toBeUndefined()
    expect(result.current.rows.length).toBeGreaterThan(0)
    expect(result.current.projectedBalanceAtRetirement).toBe(frozenRows.at(-1)?.endingBalance)
  })

  it('leaves projectedBalanceAtRetirement undefined when rows are empty (no prior valid result to fall back on)', () => {
    const core: CoreInputValues = { ...CORE, currentAge: Number.NaN }
    const { result } = renderHook(() => useProjectionState(core, ADVANCED, DEBOUNCE_MS))
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS)
    })

    expect(result.current.rows).toEqual([])
    expect(result.current.projectedBalanceAtRetirement).toBeUndefined()
    expect(result.current.error).toBeDefined()
  })
})
