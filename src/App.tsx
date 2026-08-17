import { useMemo, useRef, useState } from 'react'
import { CoreInputsForm, Layout, Table, TableRow, isCoreInputValid, type CoreInputValues } from './ui/components'
import { useDebouncedValue } from './ui/hooks/useDebouncedValue'
import { formatCurrency } from './ui/utils/format'
import { runProjection, InvalidProjectionInputError, type PlanAssumptions } from './engine'
import './App.css'

const DEFAULT_CORE_VALUES: CoreInputValues = {
  currentAge: 35,
  retirementAge: 67,
  initialBalance: 250000,
  currentAnnualIncome: 85000,
  annualContributionRatePercent: 15,
}

/**
 * Advanced-assumption defaults from FIN-10's spec, hardcoded here until that ticket lands
 * its own editable UI. Allocation and planning horizon are call-site defaults per FIN-19 —
 * not user input for the MVP.
 */
const ADVANCED_DEFAULTS = {
  annualRaiseRate: 0.03,
  annualReturnRate: 0.07,
  inflationRate: 0.025,
  withdrawalRateInRetirement: 0.04,
}

const PLANNING_HORIZON_END_AGE = 100

/** Per FIN-9's notes: form updates are debounced ~300ms before triggering recalculation. */
const RECALCULATION_DEBOUNCE_MS = 300

function toAssumptions(core: CoreInputValues): PlanAssumptions {
  return {
    currentAge: core.currentAge,
    retirementAge: core.retirementAge,
    initialBalance: core.initialBalance,
    currentAnnualIncome: core.currentAnnualIncome,
    annualContributionRate: core.annualContributionRatePercent / 100,
    planningHorizonEndAge: PLANNING_HORIZON_END_AGE,
    ...ADVANCED_DEFAULTS,
  }
}

type ProjectionResult = { rows: ReturnType<typeof runProjection>; error: string | undefined }

function App() {
  const [coreValues, setCoreValues] = useState(DEFAULT_CORE_VALUES)
  // Fields update immediately for typing/validation feedback; the projection recalculation
  // itself is debounced ~300ms per FIN-9's notes.
  const debouncedCoreValues = useDebouncedValue(coreValues, RECALCULATION_DEBOUNCE_MS)

  // Holds the last successfully computed projection so the table can "pause" — keep
  // showing the last valid result — while a core field is out of range (FIN-9 AC),
  // instead of running the engine on a value the UI itself has flagged invalid.
  const lastValidResult = useRef<ProjectionResult>({ rows: [], error: undefined })

  const { rows, error } = useMemo((): ProjectionResult => {
    if (!isCoreInputValid(debouncedCoreValues)) {
      return lastValidResult.current
    }
    try {
      const result: ProjectionResult = { rows: runProjection(toAssumptions(debouncedCoreValues)), error: undefined }
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
  }, [debouncedCoreValues])

  return (
    <Layout
      form={<CoreInputsForm values={coreValues} onChange={setCoreValues} />}
      results={
        error ? (
          <output>{error}</output>
        ) : (
          <Table caption="Year-by-year projection">
            <thead>
              <tr>
                <th>Age</th>
                <th>Balance start</th>
                <th>Balance end</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <TableRow key={row.year}>
                  <td>{row.age}</td>
                  <td>{formatCurrency(row.beginningBalance)}</td>
                  <td>{formatCurrency(row.endingBalance)}</td>
                </TableRow>
              ))}
            </tbody>
          </Table>
        )
      }
    />
  )
}

export default App
