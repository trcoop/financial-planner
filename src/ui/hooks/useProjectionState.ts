import { useMemo, useRef } from 'react'
import {
  runProjection,
  toTodaysDollarRows,
  blendedPortfolioReturn,
  InvalidProjectionInputError,
  type AdditionalIncome,
  type PlanAssumptions,
  type PlanEvent,
} from '../../engine'
import { isAdvancedInputValid, isCoreInputValid } from '../components'
import type { Account, AdvancedAssumptionValues, CoreInputValues, Person } from '../components'
import { medicarePartBEvent, spouseMedicarePartBEvent } from '../medicareEvent'
import { useDebouncedValue } from './useDebouncedValue'

/** Planning horizon is a call-site default per FIN-19 — not user input for the MVP. Exported so
 * tests that need to reproduce the app's real assumptions (e.g. the FIN-64 default-calibration
 * suite) can build on the same constant rather than a second hardcoded 100. */
export const PLANNING_HORIZON_END_AGE = 100

/** Exported so tests can build the exact `PlanAssumptions` the live app would compute from a
 * given core/advanced form state — see `PLANNING_HORIZON_END_AGE`'s note. */
export function toAssumptions(core: CoreInputValues, advanced: AdvancedAssumptionValues): PlanAssumptions {
  const allocation = {
    stocksPercent: advanced.stocksAllocationPercent,
    bondsPercent: 100 - advanced.stocksAllocationPercent,
  }

  return {
    currentAge: core.currentAge,
    retirementAge: core.retirementAge,
    initialBalance: core.initialBalance,
    currentAnnualIncome: core.currentAnnualIncome,
    annualContributionRate: core.annualContributionRatePercent / 100,
    planningHorizonEndAge: PLANNING_HORIZON_END_AGE,
    annualRaiseRate: advanced.annualRaisePercent / 100,
    // FIN-65: the stock/bond blend at allocation weight. Note this linear blend of two COMPOUND
    // rates is itself an approximation: for an annually rebalanced portfolio the exact geometric
    // return carries a diversification term, `[w*sd_s^2 + (1-w)*sd_b^2 - sd_p^2] / 2`, worth about
    // +0.52pp/yr at the shipped defaults (70/30, 19.5%/7.7%, rho -0.2). Omitting it UNDERSTATES
    // the true rebalanced return, so the Plan tab errs conservative — which is the direction to
    // err in, given the failure this ticket fixed. Deliberate; do not "correct" it by reaching
    // for a variance term again without re-reading the next paragraph. This previously ran
    // through a variance-drag helper (`expectedPortfolioReturn`, deleted in FIN-65 along with
    // its private `portfolioVariance`), which subtracted a drag term to convert an
    // ARITHMETIC mean into a geometric one. That double-counted: the advanced form's return
    // inputs are read as compound rates (as ProjectionLab's equivalent fields are — driving
    // their shipped worker bundle in deterministic mode showed it applying the configured
    // assumptions with no drag adjustment; see the note in `calibration.test.ts` on why that
    // observation is not reproducible from this repo), and `safeWithdrawalRates.ts` is
    // calibrated against realised
    // historical compound returns. Discounting an already-geometric number and then comparing
    // it to an undiscounted one put the default plan 0.58pp/yr underwater at its own "safe"
    // withdrawal rate — a Plan chart draining from year one beside a 90% success badge.
    // `calibration.test.ts` pins the invariant: real return >= the published withdrawal rate.
    annualReturnRate: blendedPortfolioReturn(
      allocation,
      advanced.annualReturnPercent / 100,
      advanced.bondReturnPercent / 100,
    ),
    inflationRate: advanced.inflationPercent / 100,
    withdrawalRateInRetirement: advanced.withdrawalRatePercent / 100,
  }
}

type ProjectionResult = { rows: ReturnType<typeof runProjection>; error: string | undefined }

export type ProjectionState = ProjectionResult & {
  projectedBalanceAtRetirement: number | undefined
  /** Assumptions built from the debounced (not raw) input values, for consumers like
   * StressTestSection that should run against the same settled values the projection used. */
  assumptions: PlanAssumptions
  /** The debounced (settled) core/advanced values this projection was computed from. Exposed
   * so callers (App.tsx's persistence effect, FIN-43) can key off the same ~300ms settle point
   * the projection itself uses, rather than introducing a second debounce mechanism. */
  debouncedCore: CoreInputValues
  debouncedAdvanced: AdvancedAssumptionValues
  /** The events passed to `runProjection` for this computation — the unconditional primary
   * Medicare Part B event, plus (FIN-114) the spousal one when a non-primary `Person` with a
   * finite age is present in the Profile People list. Built once, here, so a future Monte Carlo
   * call site reads this exact array instead of rebuilding its own copy with separate logic. */
  events: PlanEvent[]
}

/**
 * Owns the debounced projection recalculation that used to live inline in App.tsx: fields
 * update immediately for typing/validation feedback, but the projection recalculation itself
 * is debounced (per FIN-9's notes) and "pauses" — keeps showing the last successfully computed
 * result — while a core or advanced field is out of range (FIN-9 / FIN-10 AC), instead of
 * running the engine on a value the UI itself has flagged invalid.
 */
export function useProjectionState(
  coreValues: CoreInputValues,
  advancedValues: AdvancedAssumptionValues,
  debounceMs: number,
  people: Person[] = [],
  accounts: Account[] = [],
  /**
   * The household's retirement spending goal (FIN-138), already converted to engine-ready
   * ANNUAL dollars in today's terms — deliberately a plain number, not a UI-layer type: unit
   * conversion (e.g. monthly vs. annual entry mode) is the concern of whatever future UI
   * collects this value, not this hook. `undefined` and `0` both mean "no goal set" (a $0
   * spending goal has no coherent product meaning worth representing separately) — either
   * omits `retirementSpendingGoal` from `assumptions` entirely, reproducing today's
   * rate-driven behavior unchanged.
   */
  retirementSpendingGoalAnnualAmount?: number,
  /**
   * FIN-136: the Retirement Spending tab's editable Medicare Part B lines, already debounced by
   * the caller the same way `retirementSpendingGoalAnnualAmount` above is. `undefined` means
   * "use the suggested default" (`MEDICARE_PART_B_EVENT.annualAmount`) — passed straight through
   * to `medicarePartBEvent`/`spouseMedicarePartBEvent`'s own `annualAmountOverride` param.
   */
  primaryMedicareAnnualAmount?: number,
  /** Spouse's own override, same terms as `primaryMedicareAnnualAmount` above — only consulted
   * when a spouse is present in `people` (see `events` below). */
  spouseMedicareAnnualAmount?: number,
): ProjectionState {
  const debouncedCoreValues = useDebouncedValue(coreValues, debounceMs)
  const debouncedAdvancedValues = useDebouncedValue(advancedValues, debounceMs)
  // FIN-114: debounced like core/advanced, so a spouse add/remove settles on the same ~300ms
  // cadence as every other input this hook recomputes from, rather than firing immediately.
  const debouncedPeople = useDebouncedValue(people, debounceMs)
  // FIN-118: same debounce cadence as `people` above, for the same reason — an account edit
  // (contribution mode/value) shouldn't recompute the projection on every keystroke.
  const debouncedAccounts = useDebouncedValue(accounts, debounceMs)

  const lastValidResult = useRef<ProjectionResult>({ rows: [], error: undefined })

  // FIN-118: every non-primary Person with a usable (finite) age/retirementAge, plus the
  // dollar contribution their owned Accounts make, expressed as `AdditionalIncome` entries the
  // engine sums into household income/contribution — see `computeIncome` (pipeline.ts). Built
  // from `debouncedAdvancedValues.annualRaisePercent` directly (not `assumptions.annualRaiseRate`
  // below) to avoid a circular dependency between the two memos.
  const additionalIncomes = useMemo((): AdditionalIncome[] => {
    const raiseRate = debouncedAdvancedValues.annualRaisePercent / 100
    return debouncedPeople
      .filter((person) => !person.isPrimary && Number.isFinite(person.age) && Number.isFinite(person.retirementAge))
      .map((person): AdditionalIncome => {
        const ownedAccounts = debouncedAccounts.filter((account) => account.ownerId === person.id)
        const contributionRate = ownedAccounts
          .filter((account) => account.contributionMode === 'percentage')
          .reduce((sum, account) => sum + account.contributionPercentage / 100, 0)
        const fixedContribution = ownedAccounts
          .filter((account) => account.contributionMode === 'fixed')
          .reduce((sum, account) => sum + account.contributionFixed, 0)

        return {
          id: person.id,
          currentAnnualIncome: person.salary,
          annualRaiseRate: raiseRate,
          contributionRate,
          fixedContribution,
          // Same offset technique `spouseMedicarePartBEvent` uses for its own `startAge`: the
          // primary's age when THIS person reaches their own retirementAge.
          retiresAtPrimaryAge: debouncedCoreValues.currentAge + (person.retirementAge - person.age),
        }
      })
  }, [debouncedPeople, debouncedAccounts, debouncedAdvancedValues.annualRaisePercent, debouncedCoreValues.currentAge])

  // FIN-118 review fix: the primary's own account can be in `fixed` contribution mode too —
  // `syncCoreWithPrimaryAccount` (Account.ts) only ever populates `core.annualContributionRatePercent`
  // from a `percentage`-mode account, so a fixed-dollar primary contribution otherwise never
  // reaches the engine. Mirrors the `fixedContribution` sum `additionalIncomes` above computes
  // for other earners' owned accounts, restricted to the primary's own account(s).
  const primaryFixedContribution = useMemo(() => {
    const primary = debouncedPeople.find((person) => person.isPrimary)
    if (!primary) return 0
    return debouncedAccounts
      .filter((account) => account.ownerId === primary.id && account.contributionMode === 'fixed')
      .reduce((sum, account) => sum + account.contributionFixed, 0)
  }, [debouncedPeople, debouncedAccounts])

  // Bug fix (live-testing pass after FIN-118): `core.annualContributionRatePercent` (which
  // `toAssumptions` reads into `annualContributionRate` below) is derived in `PlanSection.tsx`
  // via `primaryAccountFor`, which is a bare `.find()` — only the FIRST account owned by the
  // primary. A second (or third) primary-owned percentage-mode account's `contributionPercentage`
  // was silently dropped everywhere, unlike a spouse's accounts (`additionalIncomes` above already
  // sums every owned account) or the primary's own FIXED-mode accounts (`primaryFixedContribution`
  // just above already sums every owned account). This sums the primary's percentage-mode
  // contribution across ALL of their owned accounts, the same way. `undefined` (no primary, or no
  // primary-owned accounts at all) means "defer to `core.annualContributionRatePercent` as-is" —
  // preserving exact existing behavior for every call site that doesn't pass an `accounts` array.
  const primaryContributionRate = useMemo((): number | undefined => {
    const primary = debouncedPeople.find((person) => person.isPrimary)
    if (!primary) return undefined
    const ownedAccounts = debouncedAccounts.filter((account) => account.ownerId === primary.id)
    if (ownedAccounts.length === 0) return undefined
    return ownedAccounts
      .filter((account) => account.contributionMode === 'percentage')
      .reduce((sum, account) => sum + account.contributionPercentage / 100, 0)
  }, [debouncedPeople, debouncedAccounts])

  // Hoisted above the rows computation (and reused by it) so both the deterministic
  // `runProjection` call below and the `events` memo derive from the exact same settled
  // assumptions, rather than each recomputing `toAssumptions` independently.
  const assumptions = useMemo((): PlanAssumptions => {
    const base = toAssumptions(debouncedCoreValues, debouncedAdvancedValues)
    return {
      ...base,
      annualContributionRate: primaryContributionRate ?? base.annualContributionRate,
      additionalIncomes,
      primaryFixedContribution,
      // FIN-138: an explicit 0 is treated the same as undefined — "no goal set" — per this
      // hook's own param doc comment above.
      retirementSpendingGoal: retirementSpendingGoalAnnualAmount
        ? { annualAmount: retirementSpendingGoalAnnualAmount }
        : undefined,
    }
  }, [
    debouncedCoreValues,
    debouncedAdvancedValues,
    additionalIncomes,
    primaryFixedContribution,
    primaryContributionRate,
    retirementSpendingGoalAnnualAmount,
  ])

  // FIN-114: the non-primary Person in the Profile People list, if any, with a usable (finite)
  // age — guards against malformed/legacy persisted data rather than trusting the caller.
  // `.find` deliberately takes only the FIRST such match: today's People model caps non-primary
  // entries at one spouse, so this is unambiguous. If a future person type (e.g. a dependent)
  // is ever added to `people`, this would silently treat the first one as "the spouse" for
  // Medicare purposes — revisit this line, not just the Person model, when that lands.
  const spouse = useMemo(
    () => debouncedPeople.find((person) => !person.isPrimary && Number.isFinite(person.age)),
    [debouncedPeople],
  )

  // FIN-114: constructed once, here — the single source both the deterministic `runProjection`
  // call below and any future Monte Carlo call site should read from, rather than each building
  // its own copy with separate conditional logic that could drift out of sync (e.g. one call
  // site fixing a bug and the other quietly staying stale).
  const events = useMemo((): PlanEvent[] => {
    // FIN-73: Medicare Part B is applied unconditionally, no UI opt-in/opt-out (ERD §9).
    // FIN-77: growthRate is this plan's own inflation assumption plus the historical
    // medical-vs-general-inflation spread, not a flat hardcoded rate.
    // FIN-136: an editable first-year override from the Retirement Spending tab, when set.
    const base: PlanEvent[] = [medicarePartBEvent(assumptions.inflationRate, primaryMedicareAnnualAmount)]
    if (!spouse) return base
    // FIN-114: spouse's Medicare Part B, expressed on the primary's age axis (see
    // `spouseMedicarePartBEvent`'s doc comment for the offset math).
    return [
      ...base,
      spouseMedicarePartBEvent(debouncedCoreValues.currentAge, spouse.age, assumptions.inflationRate, spouseMedicareAnnualAmount),
    ]
  }, [
    assumptions.inflationRate,
    debouncedCoreValues.currentAge,
    spouse,
    primaryMedicareAnnualAmount,
    spouseMedicareAnnualAmount,
  ])

  const { rows, error } = useMemo((): ProjectionResult => {
    if (!isCoreInputValid(debouncedCoreValues) || !isAdvancedInputValid(debouncedAdvancedValues)) {
      return lastValidResult.current
    }
    try {
      const result: ProjectionResult = {
        // FIN-65 change 3. Deflated once, here, rather than at each display site: the Plan
        // tab's chart, its "projected balance at retirement" tile and the year-detail panel
        // all read `rows`, and the failure mode worth designing out is half of one tab
        // showing future dollars while the other half shows today's. The Stress Test tab
        // renders its own fan in today's dollars for the same reason, so the two tabs report
        // comparable numbers for the same plan.
        rows: toTodaysDollarRows(runProjection(assumptions, events), assumptions.inflationRate),
        error: undefined,
      }
      lastValidResult.current = result
      return result
    } catch (err) {
      if (err instanceof InvalidProjectionInputError) {
        const result: ProjectionResult = { rows: [], error: err.message }
        lastValidResult.current = result
        return result
      }
      throw err
    }
  }, [debouncedCoreValues, debouncedAdvancedValues, assumptions, events])

  // Reports the retirement year's ENDING balance. **Known confusing; decision deferred to
  // FIN-69, do not silently "fix" it either way here.**
  //
  // The withdrawal is rated off that year's BEGINNING balance (Bengen/Trinity, FIN-65 change
  // 2), so multiplying this tile by the withdrawal rate does not reproduce the withdrawal the
  // year-detail panel shows for the same year — at the shipped defaults, $1,622,812 x 3.9% =
  // $63,290 against an actual $61,665. Travis hit exactly that while exercising the FIN-65
  // branch. This tile is also a year further along than its label implies: it is the balance
  // at the END of the year you turn 65, not the pot you retire with.
  //
  // Left as-is deliberately. It predates FIN-65 — the tile has always reported the ending
  // balance and the withdrawal has always been rated off the beginning one; change 2 altered
  // the size of the gap, not its existence — so it is not a regression this branch should be
  // carrying, and the fix is a real UX call rather than a typo. FIN-69 has the numbers, the
  // three candidate quantities and why the obvious third one (row 64's ending balance) is a
  // trap.
  //
  // An earlier draft of this comment argued the ending balance was correct because the tile
  // should agree with the chart's data point directly above it. That reasoning is recorded
  // here as contested, not as settled: nobody cross-checks a tile against a chart point by
  // eye, and the one check a user demonstrably did run is the arithmetic one.
  //
  // Related and separate: `src/ui/calibration.test.ts` calls the retirement year's BEGINNING
  // balance "the pot the retiree starts drawing from". Both files are correct about what they
  // measure, but the same English phrase now names two quantities.
  const retirementRow = rows.find((row) => row.age >= debouncedCoreValues.retirementAge)
  const projectedBalanceAtRetirement = retirementRow?.endingBalance ?? rows.at(-1)?.endingBalance

  return {
    rows,
    error,
    projectedBalanceAtRetirement,
    assumptions,
    debouncedCore: debouncedCoreValues,
    debouncedAdvanced: debouncedAdvancedValues,
    events,
  }
}
