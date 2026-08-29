import { useMemo, useRef } from 'react'
import {
  runProjection,
  toTodaysDollarRows,
  blendedPortfolioReturn,
  InvalidProjectionInputError,
  type PlanAssumptions,
} from '../../engine'
import { isAdvancedInputValid, isCoreInputValid } from '../components'
import type { AdvancedAssumptionValues, CoreInputValues } from '../components'
import { medicarePartBEvent } from '../medicareEvent'
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
): ProjectionState {
  const debouncedCoreValues = useDebouncedValue(coreValues, debounceMs)
  const debouncedAdvancedValues = useDebouncedValue(advancedValues, debounceMs)

  const lastValidResult = useRef<ProjectionResult>({ rows: [], error: undefined })

  const { rows, error } = useMemo((): ProjectionResult => {
    if (!isCoreInputValid(debouncedCoreValues) || !isAdvancedInputValid(debouncedAdvancedValues)) {
      return lastValidResult.current
    }
    try {
      const planAssumptions = toAssumptions(debouncedCoreValues, debouncedAdvancedValues)
      const result: ProjectionResult = {
        // FIN-65 change 3. Deflated once, here, rather than at each display site: the Plan
        // tab's chart, its "projected balance at retirement" tile and the year-detail panel
        // all read `rows`, and the failure mode worth designing out is half of one tab
        // showing future dollars while the other half shows today's. The Stress Test tab
        // renders its own fan in today's dollars for the same reason, so the two tabs report
        // comparable numbers for the same plan.
        rows: toTodaysDollarRows(
          // FIN-73: Medicare Part B is applied unconditionally, no UI opt-in/opt-out (ERD §9).
          // FIN-77: growthRate is this plan's own inflation assumption plus the historical
          // medical-vs-general-inflation spread, not a flat hardcoded rate.
          runProjection(planAssumptions, [medicarePartBEvent(planAssumptions.inflationRate)]),
          planAssumptions.inflationRate,
        ),
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
  }, [debouncedCoreValues, debouncedAdvancedValues])

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

  // Memoized so the reference only changes when the settled values it's derived from do — a
  // fresh object on every render would trip StressTestSection's cancel-on-input-change effect
  // (keyed on this reference) even when nothing the user entered actually changed, e.g. on an
  // unrelated App re-render like selecting a different chart bar.
  const assumptions = useMemo(
    () => toAssumptions(debouncedCoreValues, debouncedAdvancedValues),
    [debouncedCoreValues, debouncedAdvancedValues],
  )

  return {
    rows,
    error,
    projectedBalanceAtRetirement,
    assumptions,
    debouncedCore: debouncedCoreValues,
    debouncedAdvanced: debouncedAdvancedValues,
  }
}
