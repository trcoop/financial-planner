import { useState } from 'react'
import {
  AdvancedAssumptionsForm,
  Card,
  CoreInputsForm,
  StatTile,
  StressTestSection,
  type AdvancedAssumptionValues,
  type CoreInputValues,
} from './ui/components'
import { TopBar } from './ui/components/TopBar/TopBar'
import { TabBar, type TabBarTab } from './ui/components/TabBar/TabBar'
import { Drawer } from './ui/components/Drawer/Drawer'
import { ChartContainer } from './ui/components/ChartContainer/ChartContainer'
import type { ChartRow } from './ui/components/ChartContainer/types'
import { YearDetailPanel } from './ui/components/YearDetailPanel/YearDetailPanel'
import { useProjectionState } from './ui/hooks/useProjectionState'
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

/** Per FIN-9's notes: form updates are debounced ~300ms before triggering recalculation. */
const RECALCULATION_DEBOUNCE_MS = 300

const TABS: TabBarTab[] = [
  { id: 'projection', label: 'Projection' },
  { id: 'stress-test', label: 'Stress Test' },
]

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
  // itself is debounced ~300ms per FIN-9's notes, and "pauses" — keeps showing the last valid
  // result — while a field is out of range. See useProjectionState for the full behavior.
  const { rows, error, projectedBalanceAtRetirement, assumptions } = useProjectionState(
    coreValues,
    advancedValues,
    RECALCULATION_DEBOUNCE_MS,
  )

  const successRateValue =
    successRate === null ? 'Run a stress test to see this' : formatPercent(successRate)

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
                className="tabPanel"
              >
                <div className="statTiles">
                  <StatTile label="Current investment balance" value={formatCurrency(coreValues.initialBalance)} />
                  <StatTile
                    label={`Projected balance at ${coreValues.retirementAge}`}
                    value={projectedBalanceAtRetirement !== undefined ? formatCurrency(projectedBalanceAtRetirement) : '—'}
                  />
                  <StatTile
                    label="Chance of success"
                    value={successRateValue}
                    isPlaceholder={successRate === null}
                  />
                </div>

                <div className="chartRow">
                  <ChartContainer rows={rows} title="Investment balance by year" onSelectRow={setSelectedRow} />
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
