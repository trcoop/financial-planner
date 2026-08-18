import { useMemo, useRef, useState } from 'react'
import {
  AdvancedAssumptionsForm,
  Card,
  CoreInputsForm,
  StatTile,
  StressTestSection,
  isAdvancedInputValid,
  isCoreInputValid,
  type AdvancedAssumptionValues,
  type CoreInputValues,
} from './ui/components'
import { TopBar } from './ui/components/TopBar/TopBar'
import { TabBar, type TabBarTab } from './ui/components/TabBar/TabBar'
import { Drawer } from './ui/components/Drawer/Drawer'
import { ChartContainer } from './ui/components/ChartContainer/ChartContainer'
import type { ChartRow } from './ui/components/ChartContainer/types'
import { YearDetailPanel } from './ui/components/YearDetailPanel/YearDetailPanel'
import { useDebouncedValue } from './ui/hooks/useDebouncedValue'
import { runProjection, InvalidProjectionInputError, type PlanAssumptions } from './engine'
import { formatCurrency, formatPercent } from './ui/utils/format'
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

const TABS: TabBarTab[] = [
  { id: 'projection', label: 'Projection' },
  { id: 'stress-test', label: 'Stress Test' },
]

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
  const [activeTab, setActiveTab] = useState<string>(TABS[0].id)
  const [selectedRow, setSelectedRow] = useState<ChartRow | undefined>(undefined)
  // Lifted out of StressTestSection (via its `onSuccessRateChange` seam) purely so the
  // Projection tab's "chance of success" StatTile can show it — StressTestSection itself
  // still owns all Monte Carlo state/logic.
  const [successRate, setSuccessRate] = useState<number | null>(null)

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

  const retirementRow = rows.find((row) => row.age >= debouncedCoreValues.retirementAge)
  const projectedBalanceAtRetirement = retirementRow?.endingBalance ?? rows.at(-1)?.endingBalance

  const successRateValue =
    successRate === null ? 'Run a stress test to see this' : formatPercent(successRate * 100)

  return (
    <div className="shell">
      <TopBar />
      <TabBar tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="body">
        <Drawer label="Plan inputs">
          <CoreInputsForm values={coreValues} onChange={setCoreValues} />
          <AdvancedAssumptionsForm values={advancedValues} onChange={setAdvancedValues} />
        </Drawer>

        <div className="main">
          {error ? (
            <output>{error}</output>
          ) : (
            <>
              <section
                role="tabpanel"
                id="tabpanel-projection"
                aria-labelledby="tab-projection"
                hidden={activeTab !== 'projection'}
              >
                <div className="statTiles">
                  <StatTile label="Current balance" value={formatCurrency(coreValues.initialBalance)} />
                  <StatTile
                    label="Projected balance at retirement"
                    value={projectedBalanceAtRetirement !== undefined ? formatCurrency(projectedBalanceAtRetirement) : '—'}
                  />
                  <StatTile
                    label="Chance of success"
                    value={successRateValue}
                    isPlaceholder={successRate === null}
                  />
                </div>

                <div className="chartRow">
                  <ChartContainer rows={rows} title="Year-by-year projection" onSelectRow={setSelectedRow} />
                  <YearDetailPanel row={selectedRow ?? rows.at(-1)} />
                </div>
              </section>

              <section
                role="tabpanel"
                id="tabpanel-stress-test"
                aria-labelledby="tab-stress-test"
                hidden={activeTab !== 'stress-test'}
              >
                <Card>
                  <StressTestSection assumptions={assumptions} onSuccessRateChange={setSuccessRate} />
                </Card>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
