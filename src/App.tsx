import { useMemo, useRef, useState } from 'react'
import {
  AdvancedAssumptionsForm,
  CoreInputsForm,
  Layout,
  ProjectionTable,
  StressTestSection,
  isAdvancedInputValid,
  isCoreInputValid,
  type AdvancedAssumptionValues,
  type CoreInputValues,
} from './ui/components'
import { useDebouncedValue } from './ui/hooks/useDebouncedValue'
import { runProjection, InvalidProjectionInputError, type PlanAssumptions } from './engine'
import './App.css'

const DEFAULT_CORE_VALUES: CoreInputValues = {
  currentAge: 35,
  retirementAge: 67,
  initialBalance: 250000,
  currentAnnualIncome: 85000,
  annualContributionRatePercent: 15,
}

/** Advanced-assumption defaults per FIN-10's spec. Planning horizon is a call-site default
 * per FIN-19 — not user input for the MVP. */
const DEFAULT_ADVANCED_VALUES: AdvancedAssumptionValues = {
  annualRaisePercent: 3,
  annualReturnPercent: 7,
  inflationPercent: 2.5,
  withdrawalRatePercent: 4,
}

const PLANNING_HORIZON_END_AGE = 100

/** Per FIN-9's notes: form updates are debounced ~300ms before triggering recalculation. */
const RECALCULATION_DEBOUNCE_MS = 300

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

function App() {
  const [coreValues, setCoreValues] = useState(DEFAULT_CORE_VALUES)
  const [advancedValues, setAdvancedValues] = useState(DEFAULT_ADVANCED_VALUES)
  // Fields update immediately for typing/validation feedback; the projection recalculation
  // itself is debounced ~300ms per FIN-9's notes.
  const debouncedCoreValues = useDebouncedValue(coreValues, RECALCULATION_DEBOUNCE_MS)
  const debouncedAdvancedValues = useDebouncedValue(advancedValues, RECALCULATION_DEBOUNCE_MS)

  // Holds the last successfully computed projection so the table can "pause" — keep
  // showing the last valid result — while a core or advanced field is out of range
  // (FIN-9 / FIN-10 AC), instead of running the engine on a value the UI itself has
  // flagged invalid.
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

  const assumptions = toAssumptions(debouncedCoreValues, debouncedAdvancedValues)

  return (
    <Layout
      form={
        <>
          <CoreInputsForm values={coreValues} onChange={setCoreValues} />
          <AdvancedAssumptionsForm values={advancedValues} onChange={setAdvancedValues} />
        </>
      }
      results={
        error ? (
          <output>{error}</output>
        ) : (
          <>
            <ProjectionTable rows={rows} />
            <StressTestSection assumptions={assumptions} />
          </>
        )
      }
    />
  )
}

export default App
