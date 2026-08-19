import { useEffect, useState } from 'react'
import {
  AdvancedAssumptionsForm,
  Button,
  Card,
  CoreInputsForm,
  DEFAULT_ADVANCED_VALUES,
  DEFAULT_CORE_VALUES,
  StatTile,
  StressTestSection,
} from './ui/components'
import { TopBar } from './ui/components/TopBar/TopBar'
import { TabBar, type TabBarTab } from './ui/components/TabBar/TabBar'
import { Drawer } from './ui/components/Drawer/Drawer'
import { ChartContainer } from './ui/components/ChartContainer/ChartContainer'
import type { ChartRow } from './ui/components/ChartContainer/types'
import { DEFAULT_RETURN_ASSUMPTIONS } from './engine'
import { YearDetailPanel } from './ui/components/YearDetailPanel/YearDetailPanel'
import { useProjectionState } from './ui/hooks/useProjectionState'
import { formatCurrency, formatPercent } from './ui/utils/format'
import { clearAssumptions, loadAssumptions, saveAssumptions } from './storage'
import './App.css'

/** Per FIN-9's notes: form updates are debounced ~300ms before triggering recalculation. */
const RECALCULATION_DEBOUNCE_MS = 300

const TABS: TabBarTab[] = [
  { id: 'projection', label: 'Projection' },
  { id: 'stress-test', label: 'Stress Test' },
]

function App() {
  const [coreValues, setCoreValues] = useState(() => loadAssumptions()?.core ?? DEFAULT_CORE_VALUES)
  const [advancedValues, setAdvancedValues] = useState(
    () => loadAssumptions()?.advanced ?? DEFAULT_ADVANCED_VALUES,
  )
  const [activeTab, setActiveTab] = useState<string>(TABS[0].id)
  const [selectedRow, setSelectedRow] = useState<ChartRow | undefined>(undefined)
  // Lifted out of StressTestSection (via its `onSuccessRateChange` seam) purely so the
  // Projection tab's "chance of success" StatTile can show it — StressTestSection itself
  // still owns all Monte Carlo state/logic.
  const [successRate, setSuccessRate] = useState<number | null>(null)

  // Fields update immediately for typing/validation feedback; the projection recalculation
  // itself is debounced ~300ms per FIN-9's notes, and "pauses" — keeps showing the last valid
  // result — while a field is out of range. See useProjectionState for the full behavior.
  const { rows, error, projectedBalanceAtRetirement, assumptions, debouncedCore, debouncedAdvanced } =
    useProjectionState(coreValues, advancedValues, RECALCULATION_DEBOUNCE_MS)

  // Persists once per settled (debounced) change, riding useProjectionState's existing ~300ms
  // debounce rather than introducing a second one (ERD §6.1). Fires once on mount too (the
  // debounced values equal the just-loaded initial state) — a harmless redundant first write,
  // not worth guarding against.
  useEffect(() => {
    saveAssumptions(debouncedCore, debouncedAdvanced)
  }, [debouncedCore, debouncedAdvanced])

  const handleReset = () => {
    if (!window.confirm('Clear your saved plan and reset to defaults?')) return
    clearAssumptions()
    setCoreValues(DEFAULT_CORE_VALUES)
    setAdvancedValues(DEFAULT_ADVANCED_VALUES)
  }

  const successRateValue =
    successRate === null ? 'Run a stress test to see this' : formatPercent(successRate)

  // Default the chart/detail panel to the retirement year rather than the last year of the
  // full horizon — that's the year people care about most on load. Falls back to the last row
  // if, for some reason, no row's age matches (e.g. retirement age outside the horizon).
  const retirementRow = rows.find((row) => row.age === coreValues.retirementAge) ?? rows.at(-1)

  return (
    <div className="shell">
      <TopBar />
      <TabBar tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="body">
        <Drawer label="Plan inputs">
          <CoreInputsForm values={coreValues} onChange={setCoreValues} />
          <AdvancedAssumptionsForm values={advancedValues} onChange={setAdvancedValues} />
          <Button variant="secondary" onClick={handleReset}>
            Reset to defaults
          </Button>
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
                  <ChartContainer
                    rows={rows}
                    title="Investment balance by year"
                    onSelectRow={setSelectedRow}
                    defaultSelectedYear={retirementRow?.year}
                    retirementAge={coreValues.retirementAge}
                  />
                  <YearDetailPanel row={selectedRow ?? retirementRow} />
                </div>
              </section>

              <section
                role="tabpanel"
                id="tabpanel-stress-test"
                aria-labelledby="tab-stress-test"
                hidden={activeTab !== 'stress-test'}
                className="tabPanel"
              >
                {/* `tabPanel` (shared with the Projection tabpanel) is what gives this section a
                    height budget from `.main` in the first place — matching `.main`'s other flex
                    child, the Drawer, which stretches to the same height by default (FIN-47 round
                    4: without this, the chart didn't line up with the left input pane the way it
                    does on the Plan tab). `stressTestCard` then passes that height on down through
                    the Card wrapper to StressTestSection's own fill-to-height chain. */}
                <Card className="stressTestCard">
                  <StressTestSection
                    assumptions={assumptions}
                    rows={rows}
                    allocation={{
                      stocksPercent: debouncedAdvanced.stocksAllocationPercent,
                      bondsPercent: 100 - debouncedAdvanced.stocksAllocationPercent,
                    }}
                    returnAssumptions={{
                      stocks: DEFAULT_RETURN_ASSUMPTIONS.stocks,
                      bonds: debouncedAdvanced.bondReturnPercent / 100,
                    }}
                    onSuccessRateChange={setSuccessRate}
                  />
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
