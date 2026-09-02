import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runProjection } from '../../engine'
import { toAssumptions, useProjectionState } from './useProjectionState'
import { medicarePartBEvent, spouseMedicarePartBEvent } from '../medicareEvent'
import type { Account, AdvancedAssumptionValues, CoreInputValues, Person } from '../components'

vi.mock('../../engine', async () => {
  const actual = await vi.importActual<typeof import('../../engine')>('../../engine')
  return { ...actual, runProjection: vi.fn(actual.runProjection) }
})

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

const PRIMARY_PERSON: Person = {
  id: 'primary',
  name: 'You',
  age: CORE.currentAge,
  retirementAge: CORE.retirementAge,
  salary: CORE.currentAnnualIncome,
  isPrimary: true,
}

const SPOUSE_PERSON: Person = {
  id: 'spouse-1',
  name: 'Spouse',
  age: 30,
  retirementAge: 65,
  salary: 0,
  isPrimary: false,
}

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
/**
 * Row index 20 — age 55, mid-accumulation. The row the rate-varying tests below deflate.
 *
 * Round 5 of the review found them pinned at `rows.length - 1` instead, which made two of the
 * three vacuous: `inflationPercent` indexes the retirement withdrawals as well as the deflator,
 * so at 6% this plan runs dry at age 92, and `clampRuin` (FIN-65 change 6) then pins age 100 at
 * exactly 0. `0` deflates to `0` under every deflator there is, so `0 ~= 0 / 1.06 ** 66` and
 * `0 < positive` both held with the deflation deleted outright.
 *
 * Before retirement no withdrawal has been taken, so the nominal balance here is genuinely
 * independent of the inflation rate and stays comfortably positive at all three rates in play
 * (~$1.56M) — which is what makes it a fair comparison point. The tests assert both of those
 * properties rather than trusting this comment.
 */
const SOLVENT_YEAR = 20

describe('FIN-65 wiring: the Plan tab reports today\'s dollars at a blended rate', () => {
  it('deflates the projection rows rather than passing through nominal ones', () => {
    const { result } = renderHook(() => useProjectionState(CORE, ADVANCED, DEBOUNCE_MS))
    const plan = toAssumptions(CORE, ADVANCED)
    const nominal = runProjection(plan, [medicarePartBEvent(plan.inflationRate)])
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
    const nominal = runProjection(plan, [medicarePartBEvent(plan.inflationRate)])
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
      const nominal = runProjection(plan, [medicarePartBEvent(plan.inflationRate)])

      expect(plan.inflationRate).toBeCloseTo(rate, 10)
      // Pinned at SOLVENT_YEAR, not at the horizon: at 6% this plan runs dry and both sides of
      // a horizon comparison are zero. See SOLVENT_YEAR's note.
      expect(nominal[SOLVENT_YEAR].endingBalance).toBeGreaterThan(0)
      expect(result.current.rows[SOLVENT_YEAR].endingBalance).toBeCloseTo(
        nominal[SOLVENT_YEAR].endingBalance / (1 + rate) ** (SOLVENT_YEAR + 1),
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

  it('deflates the same nominal balance by more at a higher inflation rate', () => {
    // The relationship the fixed-rate cases cannot see: two different user inputs must produce
    // two different real numbers from one identical nominal one.
    const advanced1 = { ...ADVANCED, inflationPercent: 1 }
    const advanced6 = { ...ADVANCED, inflationPercent: 6 }
    const at1 = renderHook(() => useProjectionState(CORE, advanced1, DEBOUNCE_MS))
    const at6 = renderHook(() => useProjectionState(CORE, advanced6, DEBOUNCE_MS))

    // The premise, asserted rather than assumed: same return rate, and — at SOLVENT_YEAR — the
    // same nominal balance, so the only thing that can move the two real figures apart is the
    // deflator. Both halves are needed. An earlier version of this test asserted neither and
    // claimed in a comment that the whole nominal series was rate-independent; it is not, since
    // `inflationRate` also indexes the retirement withdrawals.
    expect(toAssumptions(CORE, advanced1).annualReturnRate).toBeCloseTo(
      toAssumptions(CORE, advanced6).annualReturnRate,
      10,
    )
    expect(runProjection(toAssumptions(CORE, advanced6))[SOLVENT_YEAR].endingBalance).toBeCloseTo(
      runProjection(toAssumptions(CORE, advanced1))[SOLVENT_YEAR].endingBalance,
      6,
    )

    const real1 = at1.result.current.rows[SOLVENT_YEAR].endingBalance
    const real6 = at6.result.current.rows[SOLVENT_YEAR].endingBalance

    // A ratio, not an inequality. `real6 < real1` is satisfied by any deflator that merely
    // trends the right way — including several wrong ones — whereas dividing one deflated
    // figure by the other cancels the shared nominal balance and leaves exactly the ratio of
    // the two price levels, (1.06 / 1.01) ** (SOLVENT_YEAR + 1), with nothing else in it.
    expect(real6).toBeGreaterThan(0)
    expect(real1 / real6).toBeCloseTo((1.06 / 1.01) ** (SOLVENT_YEAR + 1), 6)
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

describe('useProjectionState Medicare wiring (FIN-73)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.mocked(runProjection).mockClear()
  })

  it('passes [medicarePartBEvent(inflationRate)] to runProjection unconditionally, with no opt-in/opt-out', () => {
    vi.mocked(runProjection).mockClear()
    renderHook(() => useProjectionState(CORE, ADVANCED, DEBOUNCE_MS))
    const plan = toAssumptions(CORE, ADVANCED)

    expect(runProjection).toHaveBeenCalledWith(expect.anything(), [medicarePartBEvent(plan.inflationRate)])
  })
})

/**
 * FIN-114: supersedes FIN-113's `hasSpouse`/`spouseAge` plan (never wired up) — spouse presence
 * and age now come from the Profile People list's non-primary `Person`, not any field on
 * `CoreInputValues`.
 */
describe('useProjectionState spousal Medicare wiring (FIN-114)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.mocked(runProjection).mockClear()
  })

  it('includes only the primary Medicare event when no spouse is in the People list', () => {
    vi.mocked(runProjection).mockClear()
    renderHook(() => useProjectionState(CORE, ADVANCED, DEBOUNCE_MS, [PRIMARY_PERSON]))
    const plan = toAssumptions(CORE, ADVANCED)

    expect(runProjection).toHaveBeenCalledWith(expect.anything(), [medicarePartBEvent(plan.inflationRate)])
  })

  it('includes only the primary Medicare event when the People list is empty', () => {
    vi.mocked(runProjection).mockClear()
    renderHook(() => useProjectionState(CORE, ADVANCED, DEBOUNCE_MS, []))
    const plan = toAssumptions(CORE, ADVANCED)

    expect(runProjection).toHaveBeenCalledWith(expect.anything(), [medicarePartBEvent(plan.inflationRate)])
  })

  it('includes both the primary and spousal Medicare events when a spouse is present, with the correct startAge', () => {
    vi.mocked(runProjection).mockClear()
    renderHook(() => useProjectionState(CORE, ADVANCED, DEBOUNCE_MS, [PRIMARY_PERSON, SPOUSE_PERSON]))
    const plan = toAssumptions(CORE, ADVANCED)
    const expectedSpouseEvent = spouseMedicarePartBEvent(CORE.currentAge, SPOUSE_PERSON.age, plan.inflationRate)

    expect(runProjection).toHaveBeenCalledWith(expect.anything(), [
      medicarePartBEvent(plan.inflationRate),
      expectedSpouseEvent,
    ])
    // Pin the exact startAge math this ticket cares about, not just "some event landed".
    expect(expectedSpouseEvent.startAge).toBe(CORE.currentAge + (65 - SPOUSE_PERSON.age))
  })

  it('constructs the events array once and passes the identical array to runProjection (no per-branch rebuild)', () => {
    vi.mocked(runProjection).mockClear()
    const { result } = renderHook(() => useProjectionState(CORE, ADVANCED, DEBOUNCE_MS, [PRIMARY_PERSON, SPOUSE_PERSON]))

    const callArgs = vi.mocked(runProjection).mock.calls.at(-1)
    expect(callArgs).toBeDefined()
    const eventsPassedToEngine = callArgs![1]

    // `result.current.events` is the same array reference used for the deterministic
    // `runProjection` call — the single source a Monte Carlo call site would also read from,
    // rather than each caller rebuilding its own copy with separate logic.
    expect(result.current.events).toBe(eventsPassedToEngine)
  })

  it('stops including the spousal event on the next recompute after the spouse is removed from People', () => {
    const { result, rerender } = renderHook(
      ({ people }: { people: Person[] }) => useProjectionState(CORE, ADVANCED, DEBOUNCE_MS, people),
      { initialProps: { people: [PRIMARY_PERSON, SPOUSE_PERSON] } },
    )
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS)
    })
    expect(result.current.events).toHaveLength(2)

    rerender({ people: [PRIMARY_PERSON] })
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS)
    })

    expect(result.current.events).toHaveLength(1)
    expect(result.current.events.some((event) => 'id' in event && event.id === 'medicareSpousePartB')).toBe(false)
  })

  it('ignores a non-primary Person with a non-finite age (malformed data) rather than crashing', () => {
    vi.mocked(runProjection).mockClear()
    const malformedSpouse: Person = { ...SPOUSE_PERSON, age: Number.NaN }
    renderHook(() => useProjectionState(CORE, ADVANCED, DEBOUNCE_MS, [PRIMARY_PERSON, malformedSpouse]))
    const plan = toAssumptions(CORE, ADVANCED)

    expect(runProjection).toHaveBeenCalledWith(expect.anything(), [medicarePartBEvent(plan.inflationRate)])
  })
})

/**
 * FIN-118: spouse salary and their owned Accounts' contributions now reach the engine as
 * `assumptions.additionalIncomes`, resolved the same way in both the deterministic call
 * (`runProjection`, exercised here) and the Monte Carlo call site (`StressTestSection`, which
 * reads this same `assumptions` object — see that requirement in the ticket).
 */
describe('useProjectionState additionalIncomes wiring (FIN-118)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.mocked(runProjection).mockClear()
  })

  const SPOUSE_WITH_SALARY: Person = { ...SPOUSE_PERSON, salary: 60_000, retirementAge: 65 }

  const percentageAccount = (ownerId: string, contributionPercentage: number): Account => ({
    id: `${ownerId}-pct`,
    name: 'Account',
    type: 'taxable',
    balance: 0,
    contributionMode: 'percentage',
    contributionPercentage,
    contributionFixed: 0,
    ownerId,
  })

  const fixedAccount = (ownerId: string, contributionFixed: number): Account => ({
    id: `${ownerId}-fixed`,
    name: 'Account',
    type: 'taxable',
    balance: 0,
    contributionMode: 'fixed',
    contributionPercentage: 0,
    contributionFixed,
    ownerId,
  })

  it('leaves assumptions.additionalIncomes empty when there is no spouse', () => {
    const { result } = renderHook(() => useProjectionState(CORE, ADVANCED, DEBOUNCE_MS, [PRIMARY_PERSON], []))
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS)
    })

    expect(result.current.assumptions.additionalIncomes).toEqual([])
  })

  it('sums a spouse-owned percentage-mode account contribution rate into additionalIncomes', () => {
    const accounts = [percentageAccount(SPOUSE_WITH_SALARY.id, 10)]
    const { result } = renderHook(() =>
      useProjectionState(CORE, ADVANCED, DEBOUNCE_MS, [PRIMARY_PERSON, SPOUSE_WITH_SALARY], accounts),
    )
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS)
    })

    expect(result.current.assumptions.additionalIncomes).toHaveLength(1)
    const spouseIncome = result.current.assumptions.additionalIncomes![0]
    expect(spouseIncome.id).toBe(SPOUSE_WITH_SALARY.id)
    expect(spouseIncome.currentAnnualIncome).toBe(60_000)
    expect(spouseIncome.contributionRate).toBeCloseTo(0.1, 6)
    expect(spouseIncome.fixedContribution).toBe(0)
    // Spouse retires at 65, is currently 30, primary is currently 35 -> primary is 70 when spouse retires.
    expect(spouseIncome.retiresAtPrimaryAge).toBe(CORE.currentAge + (SPOUSE_WITH_SALARY.retirementAge - SPOUSE_WITH_SALARY.age))
  })

  it('sums multiple accounts (percentage and fixed) owned by the same spouse', () => {
    const accounts = [
      percentageAccount(SPOUSE_WITH_SALARY.id, 5),
      { ...percentageAccount('unused', 5), ownerId: SPOUSE_WITH_SALARY.id, id: 'second-pct' },
      fixedAccount(SPOUSE_WITH_SALARY.id, 1_000),
    ]
    const { result } = renderHook(() =>
      useProjectionState(CORE, ADVANCED, DEBOUNCE_MS, [PRIMARY_PERSON, SPOUSE_WITH_SALARY], accounts),
    )
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS)
    })

    const spouseIncome = result.current.assumptions.additionalIncomes![0]
    expect(spouseIncome.contributionRate).toBeCloseTo(0.1, 6)
    expect(spouseIncome.fixedContribution).toBe(1_000)
  })

  it('ignores accounts owned by the primary when building additionalIncomes', () => {
    const accounts = [percentageAccount(PRIMARY_PERSON.id, 20)]
    const { result } = renderHook(() =>
      useProjectionState(CORE, ADVANCED, DEBOUNCE_MS, [PRIMARY_PERSON, SPOUSE_WITH_SALARY], accounts),
    )
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS)
    })

    const spouseIncome = result.current.assumptions.additionalIncomes![0]
    expect(spouseIncome.contributionRate).toBe(0)
    expect(spouseIncome.fixedContribution).toBe(0)
  })

  it('feeds additionalIncomes to runProjection via the same assumptions object', () => {
    vi.mocked(runProjection).mockClear()
    const accounts = [percentageAccount(SPOUSE_WITH_SALARY.id, 10)]
    renderHook(() => useProjectionState(CORE, ADVANCED, DEBOUNCE_MS, [PRIMARY_PERSON, SPOUSE_WITH_SALARY], accounts))

    const callArgs = vi.mocked(runProjection).mock.calls.at(-1)
    expect(callArgs).toBeDefined()
    const passedAssumptions = callArgs![0]
    expect(passedAssumptions.additionalIncomes).toHaveLength(1)
    expect(passedAssumptions.additionalIncomes![0].contributionRate).toBeCloseTo(0.1, 6)
  })

  it('FIN-118 review fix: sums the primary\'s own fixed-mode account contribution into assumptions.primaryFixedContribution', () => {
    const accounts = [fixedAccount(PRIMARY_PERSON.id, 2_000)]
    const { result } = renderHook(() => useProjectionState(CORE, ADVANCED, DEBOUNCE_MS, [PRIMARY_PERSON], accounts))
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS)
    })

    expect(result.current.assumptions.primaryFixedContribution).toBe(2_000)
  })

  it('leaves primaryFixedContribution at 0 for a percentage-mode primary account (regression)', () => {
    const accounts = [percentageAccount(PRIMARY_PERSON.id, 15)]
    const { result } = renderHook(() => useProjectionState(CORE, ADVANCED, DEBOUNCE_MS, [PRIMARY_PERSON], accounts))
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS)
    })

    expect(result.current.assumptions.primaryFixedContribution).toBe(0)
  })

  it('feeds primaryFixedContribution to runProjection via the same assumptions object', () => {
    vi.mocked(runProjection).mockClear()
    const accounts = [fixedAccount(PRIMARY_PERSON.id, 3_000)]
    renderHook(() => useProjectionState(CORE, ADVANCED, DEBOUNCE_MS, [PRIMARY_PERSON], accounts))

    const callArgs = vi.mocked(runProjection).mock.calls.at(-1)
    expect(callArgs).toBeDefined()
    expect(callArgs![0].primaryFixedContribution).toBe(3_000)
  })
})
