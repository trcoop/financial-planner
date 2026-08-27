import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runProjection } from '../../engine'
import { toAssumptions, useProjectionState } from './useProjectionState'
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
  bondReturnPercent: 4.5,
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

/**
 * Round 2 of the FIN-65 review found both of this ticket's user-visible changes reverting
 * without a single test failing. `App.test.tsx` asserts the LABELS — "Projected balance at 65
 * (today's dollars)", the chart title — but nothing asserted the numbers underneath them were
 * actually deflated, and nothing pinned that the Plan tab's return rate blends the two asset
 * classes at all. Dropping either wiring shipped a confidently mislabelled chart: future dollars
 * under a today's-dollars title (about 5x too high at age 100), or a 100%-bond portfolio quietly
 * compounding the stock rate.
 */
describe('FIN-65 wiring: the Plan tab reports today\'s dollars at a blended rate', () => {
  it('deflates the projection rows rather than passing through nominal ones', () => {
    const { result } = renderHook(() => useProjectionState(CORE, ADVANCED, DEBOUNCE_MS))
    const plan = toAssumptions(CORE, ADVANCED)
    const nominal = runProjection(plan)
    const year = nominal.length - 1

    // `toTodaysDollarRows` divides year N by (1 + inflation)^(N+1) — derived from the model,
    // not read back off the implementation.
    const priceLevel = (1 + plan.inflationRate) ** (year + 1)

    expect(result.current.rows[year].endingBalance).toBeCloseTo(
      nominal[year].endingBalance / priceLevel,
      6,
    )
    // Over a 65-year horizon at 2.5% the two differ ~5x. Guards against the deflation being
    // dropped entirely, which is the mutation that previously survived the whole suite.
    expect(result.current.rows[year].endingBalance).toBeLessThan(nominal[year].endingBalance / 4)
  })

  it('deflates the headline retirement tile too, not just the chart rows', () => {
    const { result } = renderHook(() => useProjectionState(CORE, ADVANCED, DEBOUNCE_MS))
    const plan = toAssumptions(CORE, ADVANCED)
    const nominal = runProjection(plan)
    const retirementYear = CORE.retirementAge - CORE.currentAge
    const priceLevel = (1 + plan.inflationRate) ** (retirementYear + 1)

    expect(result.current.projectedBalanceAtRetirement).toBeCloseTo(
      nominal[retirementYear].endingBalance / priceLevel,
      6,
    )
  })

  /**
   * Round-4 finding. The two tests above both derive their expected price level from `ADVANCED`,
   * which sets `inflationPercent: 2.5` — so a deflator hardcoded to the literal `0.025` was
   * indistinguishable from one that reads the user's value, and that mutation survived all 641
   * tests. Inflation is an editable advanced field, so the mutant is reachable: it would leave
   * the chart and the headline tile roughly 9.2x too high at 6% inflation and 2.6x too low at
   * 1%, under a label that says today's dollars.
   *
   * The fix is a second rate, not new production code. `it.each` rather than one extra case so
   * the pair straddles the fixture's 2.5% in both directions — a single higher rate would still
   * pass under a deflator stuck at any value below it.
   */
  it.each([
    [1, 0.01],
    [6, 0.06],
  ])(
    'reads the inflation rate the user entered (%i percent), not the default the other tests happen to use',
    (percent, rate) => {
      const advanced = { ...ADVANCED, inflationPercent: percent }
      const { result } = renderHook(() => useProjectionState(CORE, advanced, DEBOUNCE_MS))
      const plan = toAssumptions(CORE, advanced)
      const nominal = runProjection(plan)
      const year = nominal.length - 1

      expect(plan.inflationRate).toBeCloseTo(rate, 10)
      expect(result.current.rows[year].endingBalance).toBeCloseTo(
        nominal[year].endingBalance / (1 + rate) ** (year + 1),
        6,
      )

      // And the tile, which reads the same rows but is the figure a user quotes back.
      const retirementYear = CORE.retirementAge - CORE.currentAge
      expect(result.current.projectedBalanceAtRetirement).toBeCloseTo(
        nominal[retirementYear].endingBalance / (1 + rate) ** (retirementYear + 1),
        6,
      )
    },
  )

  it('deflates by more at a higher inflation rate, on the same nominal plan', () => {
    // The relationship the fixed-rate tests cannot see: two different user inputs must produce
    // two different real series from an identical nominal one. `annualReturnRate` is unaffected
    // by `inflationPercent`, so the nominal projection underneath these is literally the same.
    const at1 = renderHook(() => useProjectionState(CORE, { ...ADVANCED, inflationPercent: 1 }, DEBOUNCE_MS))
    const at6 = renderHook(() => useProjectionState(CORE, { ...ADVANCED, inflationPercent: 6 }, DEBOUNCE_MS))
    const year = at1.result.current.rows.length - 1

    expect(toAssumptions(CORE, { ...ADVANCED, inflationPercent: 1 }).annualReturnRate).toBeCloseTo(
      toAssumptions(CORE, { ...ADVANCED, inflationPercent: 6 }).annualReturnRate,
      10,
    )
    expect(at6.result.current.rows[year].endingBalance).toBeLessThan(
      at1.result.current.rows[year].endingBalance,
    )
  })

  it('blends the stock and bond returns at the allocation weight', () => {
    const plan = toAssumptions(CORE, { ...ADVANCED, stocksAllocationPercent: 70 })

    // 0.70 * 7% + 0.30 * 4.5% = 6.25%.
    expect(plan.annualReturnRate).toBeCloseTo(0.0625, 10)
  })

  it('uses the bond return alone at 0% stocks, so the tab cannot quote a rate the portfolio has not got', () => {
    const plan = toAssumptions(CORE, { ...ADVANCED, stocksAllocationPercent: 0 })

    expect(plan.annualReturnRate).toBeCloseTo(ADVANCED.bondReturnPercent / 100, 10)
  })

  it('uses the stock return alone at 100% stocks', () => {
    const plan = toAssumptions(CORE, { ...ADVANCED, stocksAllocationPercent: 100 })

    expect(plan.annualReturnRate).toBeCloseTo(ADVANCED.annualReturnPercent / 100, 10)
  })
})
