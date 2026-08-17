import { useMemo, useState } from 'react'
import { CoreInputsForm, Layout, Table, TableRow, type CoreInputValues } from './ui/components'
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

function App() {
  const [coreValues, setCoreValues] = useState(DEFAULT_CORE_VALUES)

  const { rows, error } = useMemo(() => {
    try {
      return { rows: runProjection(toAssumptions(coreValues)), error: undefined }
    } catch (err) {
      if (err instanceof InvalidProjectionInputError) {
        return { rows: [], error: err.message }
      }
      throw err
    }
  }, [coreValues])

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
