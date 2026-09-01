import { useEffect, useRef, useState } from 'react'
import {
  AdvancedAssumptionsForm,
  Button,
  Card,
  ConfirmDialog,
  CoreInputsForm,
  DEFAULT_ADVANCED_VALUES,
  DEFAULT_CORE_VALUES,
  StatTile,
  StressTestSection,
} from './components'
import type { StressTestSectionHandle } from './components'
import { TabBar, type TabBarTab } from './components/TabBar/TabBar'
import { LeftNav, type NavItem } from './components/LeftNav/LeftNav'
import type { ChartRow } from './components/ChartContainer/types'
import {
  PercentileLineChart,
  type LineChartRow,
  type LineChartSeries,
} from './components/PercentileLineChart/PercentileLineChart'
import { YearDetailPanel } from './components/YearDetailPanel/YearDetailPanel'
import { useProjectionState, PLANNING_HORIZON_END_AGE } from './hooks/useProjectionState'
import { MEDICARE_PART_B_EVENT } from './medicareEvent'
import { formatCurrency, formatPercent } from './utils/format'
import { clearAssumptions, loadAssumptions, saveAssumptions } from '../storage'

/** Per FIN-9's notes: form updates are debounced ~300ms before triggering recalculation. */
const RECALCULATION_DEBOUNCE_MS = 300

/**
 * FIN-98/FIN-88: PlanSection's own local TabBar — Projection / Stress Test / Profile — replaces
 * the old always-visible Drawer with a third tab that takes over its input-editing job. This
 * TabBar is local to PlanSection, not part of any shared/global nav config (LeftNav/BottomTabBar,
 * FIN-100's concern).
 *
 * FIN-115: the third tab was renamed Settings -> Profile and now hosts its own nested
 * People/Accounts/Rates nav (see PROFILE_NAV_ITEMS below) rather than showing the input forms
 * directly.
 */
const TABS: TabBarTab[] = [
  { id: 'projection', label: 'Projection' },
  { id: 'stress-test', label: 'Stress Test' },
  { id: 'profile', label: 'Profile' },
]

/**
 * FIN-115: Profile's own section-internal nav — People (default) / Accounts / Rates. Per the
 * Layout & Component System design spec's 2026-09-01 update, this is a left-hand nav rail on
 * desktop (a section-internal switcher, one level down from the app's top-level TopBar/TabBar
 * nav) and collapses to a horizontal scrollable strip on mobile.
 */
const PROFILE_NAV_ITEMS: NavItem[] = [
  { id: 'people', label: 'People' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'rates', label: 'Rates' },
]

/** Plan has a single line (the deterministic balance) — one series, legend hidden (FIN-60). */
const PLAN_SERIES: LineChartSeries[] = [{ key: 'balance', label: 'Balance', color: 'var(--color-primary)' }]

interface PlanSectionProps {}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function PlanSection(_props: PlanSectionProps) {
  const [coreValues, setCoreValues] = useState(() => loadAssumptions()?.core ?? DEFAULT_CORE_VALUES)
  const [advancedValues, setAdvancedValues] = useState(
    () => loadAssumptions()?.advanced ?? DEFAULT_ADVANCED_VALUES,
  )
  const [activeTab, setActiveTab] = useState<string>(TABS[0].id)
  // FIN-115: which Profile sub-section (People/Accounts/Rates) is showing. Plain React state,
  // scoped to this mount — same pattern as `activeTab` above; no persistence requirement per
  // the ticket ("persists within the Profile section during a session").
  const [profileTab, setProfileTab] = useState<string>(PROFILE_NAV_ITEMS[0].id)
  const [selectedRow, setSelectedRow] = useState<ChartRow | undefined>(undefined)
  // Lifted out of StressTestSection (via its `onSuccessRateChange` seam) purely so the
  // Projection tab's "chance of success" StatTile can show it — StressTestSection itself
  // still owns all Monte Carlo state/logic.
  const [successRate, setSuccessRate] = useState<number | null>(null)
  // FIN-48: "inputs changed since the last completed stress test run", lifted out of
  // StressTestSection via its `onStaleChange` seam so the Plan tab's "chance of success"
  // StatTile can swap to a "Re-run stress test" CTA — same lift-up pattern as successRate.
  //
  // A freshly-mounted PlanSection has no prior in-memory stress test result, so this starts
  // `true` on every mount (same as today's fresh-page-load behavior) — it does NOT trigger an
  // auto-run; the stress test only runs via the existing user-triggered action.
  const [isStressTestStale, setIsStressTestStale] = useState(true)
  // Imperative handle onto the (always-mounted) StressTestSection, so the CTA above can
  // trigger a re-run from the Plan tab without switching to the Stress Test tab. Local to this
  // mount of PlanSection — fine for it to be lost on unmount, same as today's page-refresh
  // behavior.
  const stressTestRef = useRef<StressTestSectionHandle>(null)
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false)

  // Mount-triggers-focus pattern (FIN-98): each tab's heading is focused whenever the local
  // `activeTab` changes, including the very first render, so switching PlanSection's own tabs
  // moves focus to the newly-shown tab's heading.
  const headingRefs = useRef<Record<string, HTMLHeadingElement | null>>({})
  useEffect(() => {
    headingRefs.current[activeTab]?.focus()
  }, [activeTab])

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
    setIsResetConfirmOpen(true)
  }

  const handleConfirmReset = () => {
    setIsResetConfirmOpen(false)
    clearAssumptions()
    setCoreValues(DEFAULT_CORE_VALUES)
    setAdvancedValues(DEFAULT_ADVANCED_VALUES)
  }

  const handleCancelReset = () => {
    setIsResetConfirmOpen(false)
  }

  const successRateValue =
    successRate === null ? 'Run a stress test to see this' : formatPercent(successRate)

  // Default the chart/detail panel to the retirement year rather than the last year of the
  // full horizon — that's the year people care about most on load. Falls back to the last row
  // if, for some reason, no row's age matches (e.g. retirement age outside the horizon).
  const retirementRow = rows.find((row) => row.age === coreValues.retirementAge) ?? rows.at(-1)

  // FIN-60: Plan's chart is now a single-line `PercentileLineChart` (shared with Stress Test)
  // rather than `ChartContainer`'s bars. It only knows about the `LineChartRow` shape (year,
  // age, values) it was clicked on — this maps that back to the full `ChartRow` so
  // `YearDetailPanel` still gets all the fields it displays.
  const planChartRows: LineChartRow[] = rows.map((row) => ({
    year: row.year,
    age: row.age,
    values: { balance: row.endingBalance },
  }))
  const handleSelectPlanRow = (lineRow: LineChartRow) => {
    const row = rows.find((r) => r.year === lineRow.year)
    if (row) setSelectedRow(row)
  }

  // FIN-73: the age-65 marker is suppressed in the two cases where it would mislabel the
  // chart — the horizon ends before 65 (Medicare never appears at all), or the plan's current
  // age is already >= 65 at t=0 (Medicare starts in period 0, so there's no "starts here"
  // point to the right of the first row to mark). Computed at the call site (not inside
  // PercentileLineChart), per ERD §9 — the chart only sees `rows`.
  const medicareStartAge =
    coreValues.currentAge < 65 && 65 <= PLANNING_HORIZON_END_AGE ? MEDICARE_PART_B_EVENT.startAge : undefined

  return (
    <>
      <TabBar tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />
      {/* FIN-65 change 3: stated once, globally, rather than parenthesised onto each tile and
        * chart title. Every figure the app displays is deflated — both tabs, the stat tiles,
        * both charts and the year-detail panels — so it is a property of the whole app, and
        * repeating it per-element read as a disclaimer rather than a unit. It sits directly
        * under the tab bar so it is above the fold on both tabs and applies visibly to
        * whichever one is open. Not `aria-hidden`: a screen-reader user needs the unit too,
        * and it is the only place it is now stated. */}
      <p className="unitsNote">All amounts in today's dollars</p>
      {/* FIN-100: renamed from the historical "body"/"main" class names to "planBody"/
        * "planMain" — App.tsx's new shell now uses those global names for its own
        * LeftNav-row/content-pane layout (see App.css), so PlanSection's own (structurally
        * unrelated) tabpanel-layout wrapper needed distinct names to avoid both rules
        * applying to nested elements of the same class. */}
      <div className="planBody">
        <div className="planMain">
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
                <h2
                  ref={(el) => {
                    headingRefs.current['projection'] = el
                  }}
                  tabIndex={-1}
                  className="sectionHeading"
                >
                  Projection
                </h2>
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
                    action={
                      isStressTestStale && successRate !== null ? (
                        <Button variant="secondary" onClick={() => stressTestRef.current?.runStressTest()}>
                          Re-run stress test
                        </Button>
                      ) : undefined
                    }
                  />
                </div>

                <div className="chartRow">
                  <PercentileLineChart
                    rows={planChartRows}
                    series={PLAN_SERIES}
                    title="Investment balance by year"
                    onSelectRow={handleSelectPlanRow}
                    defaultSelectedYear={retirementRow?.year}
                    retirementAge={coreValues.retirementAge}
                    medicareStartAge={medicareStartAge}
                    showLegend={false}
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
                    child. `stressTestCard` then passes that height on down through the Card
                    wrapper to StressTestSection's own fill-to-height chain. */}
                <h2
                  ref={(el) => {
                    headingRefs.current['stress-test'] = el
                  }}
                  tabIndex={-1}
                  className="sectionHeading"
                >
                  Stress Test
                </h2>
                <Card className="stressTestCard">
                  <StressTestSection
                    ref={stressTestRef}
                    assumptions={assumptions}
                    rows={rows}
                    allocation={{
                      stocksPercent: debouncedAdvanced.stocksAllocationPercent,
                      bondsPercent: 100 - debouncedAdvanced.stocksAllocationPercent,
                    }}
                    onSuccessRateChange={setSuccessRate}
                    onStaleChange={setIsStressTestStale}
                  />
                </Card>
              </section>

              <section
                role="tabpanel"
                id="tabpanel-profile"
                aria-labelledby="tab-profile"
                hidden={activeTab !== 'profile'}
                className="tabPanel"
              >
                <h2
                  ref={(el) => {
                    headingRefs.current['profile'] = el
                  }}
                  tabIndex={-1}
                  className="sectionHeading"
                >
                  Profile
                </h2>

                {/* FIN-115: nav shell only — desktop left-hand nav + mobile horizontal strip,
                  * both driving the same `profileTab` state. Both mount unconditionally; CSS
                  * (`.profileNavDesktop`/`.profileNavMobile` in App.css) controls which is
                  * visible per breakpoint, matching the app-shell's existing LeftNav/BottomTabBar
                  * dual-mount pattern (App.css) rather than a JS matchMedia conditional. */}
                <div className="profileLayout">
                  <div className="profileNavDesktop">
                    {/* Reuse justification (design spec §6): LeftNav is already a generic,
                      * presentational, keyboard-navigable vertical nav-rail primitive — exactly
                      * the DOM/interaction shape this needs. The PM/Eng addendum on this ticket
                      * says desktop's left-hand nav "is a new component (no existing vertical
                      * nav-rail primitive in the app)" — that premise doesn't hold, LeftNav
                      * already exists, so building a second nav-rail component from scratch
                      * would be exactly the "matching CSS is not the same as sharing a
                      * component" anti-pattern §6 warns about. The only real mismatch was
                      * visual (LeftNav's dark app-chrome styling + hardcoded "Sections" label,
                      * appropriate for the app's top-level Plan/Calculators switcher, not for a
                      * nested in-page nav) — so LeftNav gained two optional props (`ariaLabel`,
                      * `variant`) rather than a whole new component, per §6's own preferred fix.
                      * Flagged for the orchestrator to reconcile with the ticket's addendum. */}
                    <LeftNav
                      items={PROFILE_NAV_ITEMS}
                      activeId={profileTab}
                      onSelect={setProfileTab}
                      ariaLabel="Profile sections"
                      variant="inline"
                    />
                  </div>
                  <div className="profileNavMobile">
                    <TabBar
                      tabs={PROFILE_NAV_ITEMS}
                      activeTab={profileTab}
                      onTabChange={setProfileTab}
                      ariaLabel="Profile sections"
                    />
                  </div>

                  <div className="profileContent">
                    {profileTab === 'people' ? (
                      <>
                        {/* FIN-116 will replace this with the real People tab (pre-loaded self,
                          * "+ Spouse" button, Person model). Until then, the actual input forms
                          * (CoreInputsForm/AdvancedAssumptionsForm) stay mounted here rather than
                          * being dropped from the Profile view entirely — this is the app's only
                          * way to edit plan inputs today, and this ticket is nav-shell-only, so
                          * removing them with nowhere else to land would break input editing
                          * with no ticket yet covering where they go. FIN-116 should read this
                          * comment before restructuring the People tab. */}
                        <CoreInputsForm values={coreValues} onChange={setCoreValues} />
                        <AdvancedAssumptionsForm values={advancedValues} onChange={setAdvancedValues} />
                        <Button variant="secondary" onClick={handleReset}>
                          Reset to defaults
                        </Button>
                      </>
                    ) : null}

                    {profileTab === 'accounts' ? (
                      // FIN-117 builds out the real Accounts tab (Account model, CRUD, owner
                      // linking, contribution toggle). Placeholder only for this ticket.
                      <p className="profilePlaceholder">Accounts coming soon.</p>
                    ) : null}

                    {profileTab === 'rates' ? (
                      // Rates is a stub for this release (nav entry + empty state only) per the
                      // PRD — no fields, no add button, real content is a future spec.
                      <p className="profilePlaceholder">Coming soon.</p>
                    ) : null}
                  </div>
                </div>
              </section>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={isResetConfirmOpen}
        title="Reset to defaults?"
        message="Clear your saved plan and reset to defaults?"
        confirmLabel="Reset"
        cancelLabel="Cancel"
        onConfirm={handleConfirmReset}
        onCancel={handleCancelReset}
      />
    </>
  )
}
