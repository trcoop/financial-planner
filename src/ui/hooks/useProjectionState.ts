import { useMemo, useRef } from 'react'
import { runProjection, InvalidProjectionInputError, type PlanAssumptions } from '../../engine'
import { isAdvancedInputValid, isCoreInputValid } from '../components'
import type { AdvancedAssumptionValues, CoreInputValues } from '../components'
import { useDebouncedValue } from './useDebouncedValue'

/** Planning horizon is a call-site default per FIN-19 — not user input for the MVP. */
const PLANNING_HORIZON_END_AGE = 100

function toAssumptions(core: CoreInputValues, advanced: AdvancedAssumptionValues): PlanAssumptions {
  return {
    currentAge: core.currentAge,
    retirementAge: core.retirementAge,
    initialBalance: core.initialBalance,
    currentAnnualIncome: core.currentAnnualIncome,
    annualContributionRate: core.annualContributionRatePercent / 100,
    planningHorizonEndAge: PLANNING_HORIZON_END_AGE,
    annualRaiseRate: advanced.annualRaisePercent / 100,
    annualReturnRate: advanced.annualReturnPercent / 100,
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
      const result: ProjectionResult = {
        rows: runProjection(toAssumptions(debouncedCoreValues, debouncedAdvancedValues)),
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
