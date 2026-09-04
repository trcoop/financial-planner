import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AccountsTab,
  AdvancedAssumptionsForm,
  Button,
  Card,
  ConfirmDialog,
  DEFAULT_ADVANCED_VALUES,
  DEFAULT_CORE_VALUES,
  PeopleTab,
  StatTile,
  StressTestSection,
  createPrimaryPerson,
  primaryAccountFor,
  primaryPerson,
  seedAccounts,
  seedPeople,
  syncCoreWithPrimary,
  syncCoreWithPrimaryAccount,
} from './components'
import type { Account, Person } from './components'
import type { StressTestSectionHandle } from './components'
import { TabBar, type TabBarTab } from './components/TabBar/TabBar'
import { LeftNav, type NavItem } from './components/LeftNav/LeftNav'
import type { ChartRow } from './chartRow/types'
import type { PlanEvent } from '../engine/types'
import {
  PercentileLineChart,
  type LineChartRow,
  type LineChartSeries,
} from './components/PercentileLineChart/PercentileLineChart'
import { YearDetailPanel } from './components/YearDetailPanel/YearDetailPanel'
import { PeopleIcon, WalletIcon, PercentIcon, TargetIcon } from './components/icons'
import { useProjectionState, PLANNING_HORIZON_END_AGE } from './hooks/useProjectionState'
import { useDebouncedValue } from './hooks/useDebouncedValue'
import { MEDICARE_PART_B_EVENT } from './medicareEvent'
import { formatCurrency, formatPercent } from './utils/format'
import { clearAssumptions, loadAssumptions, saveAssumptions } from '../storage'
import { RetirementSpendingTab } from './components/RetirementSpendingTab/RetirementSpendingTab'
import {
  DEFAULT_RETIREMENT_SPENDING_VALUES,
  retirementSpendingGoalAnnualAmount,
  type RetirementSpendingValues,
} from './components/RetirementSpendingTab/RetirementSpendingGoal'

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
 * nav) and collapses to a horizontal scrollable strip on mobile. `icon` renders on both — the
 * same list drives desktop LeftNav and mobile TabBar, so both already know how to render it
 * (`NavItem.icon`/`TabBarTab.icon`, TabBar gained its own via FIN-115's icon follow-up).
 */
const PROFILE_NAV_ITEMS: NavItem[] = [
  { id: 'people', label: 'People', icon: PeopleIcon },
  { id: 'accounts', label: 'Accounts', icon: WalletIcon },
  { id: 'rates', label: 'Rates', icon: PercentIcon },
  // FIN-135: fourth Profile sub-tab, after Rates.
  { id: 'retirement-spending', label: 'Retirement Spending', icon: TargetIcon },
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
  // FIN-116: replaces the FIN-113 hasSpouse/spouseAge checkbox pair. Seeded once, lazily, from
  // whatever was persisted (or freshly from `coreValues` if nothing/nothing valid was) — see
  // `seedPeople`'s doc comment: it never seeds a spouse, only ever the primary Person.
  const [people, setPeople] = useState<Person[]>(() => seedPeople(loadAssumptions()?.people, coreValues))
  // FIN-117 bug-fix round: Accounts, same lazy-seed-from-persisted pattern as `people` above —
  // `seedAccounts` falls back to a single default account seeded from `coreValues`'s legacy
  // initialBalance/annualContributionRatePercent, owned by the primary Person, so a pre-FIN-117
  // record's data isn't silently lost.
  const [accounts, setAccounts] = useState<Account[]>(() => {
    const loaded = loadAssumptions()
    const seededPeople = seedPeople(loaded?.people, coreValues)
    const primaryId = primaryPerson(seededPeople)?.id ?? seededPeople[0]?.id ?? 'primary'
    return seedAccounts(loaded?.accounts, primaryId, coreValues)
  })
  // FIN-135: household retirement spending goal + Medicare overrides, same lazy-load-from-
  // persisted pattern as `people`/`accounts` above. Absent-on-load resolves to
  // `DEFAULT_RETIREMENT_SPENDING_VALUES` (`{}`) — no goal set, matching the AC's opt-in default.
  const [retirementSpendingValues, setRetirementSpendingValues] = useState<RetirementSpendingValues>(
    () => loadAssumptions()?.retirementSpending ?? DEFAULT_RETIREMENT_SPENDING_VALUES,
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

  // FIN-116 follow-up: the primary Person's age/retirementAge (People tab) are the source of
  // truth; CoreInputsForm no longer renders those two fields at all. `effectiveCoreValues`
  // overrides them onto `coreValues` so every consumer below (the engine via
  // useProjectionState, the stat tiles, the chart's retirement-age marker, the persisted
  // record) sees the current value regardless of which form last changed it, and the two
  // copies can never drift independently. See `syncCoreWithPrimary`'s doc comment.
  // Memoized (rather than recomputed as a fresh object every render) so identity is stable
  // across renders that don't actually change age/retirementAge/coreValues — `useDebouncedValue`
  // below restarts its timer whenever the value it's given changes *reference*, so an
  // unmemoized new object on every render (e.g. from an unrelated tab switch) would never let
  // the debounce settle and would fire an extra save. See PlanSection.test.tsx "never saves on
  // chart selection or tab switches".
  const primary = people.find((person) => person.isPrimary)
  // FIN-135: gates the Retirement Spending tab's spouse Medicare field — same check PeopleTab
  // itself uses to gate its own "+ Spouse" button/spouse card.
  const hasSpouse = people.some((person) => !person.isPrimary)
  // FIN-117 bug-fix round: same reasoning as above, extended to initialBalance/
  // annualContributionRatePercent — those two fields moved to the primary's Account (Accounts
  // tab) and CoreInputsForm no longer renders them at all, so they must be synced in here too
  // rather than reading a now-permanently-stale `coreValues` field. See
  // `syncCoreWithPrimaryAccount`'s doc comment for the fixed-contribution-mode caveat.
  const primaryAccount = primary ? primaryAccountFor(accounts, primary.id) : undefined
  // Bug fix (FIN-129): `syncCoreWithPrimaryAccount`'s `initialBalance` is the household's
  // starting balance — summed across EVERY account, primary or spouse (not just `primaryAccount`,
  // which is only the primary's first — kept above for its contribution-mode/rate fields,
  // unaffected by this fix), so the deps below must include every account's balance, not just
  // `primaryAccount?.balance`.
  const totalAccountBalance = accounts.reduce((sum, account) => sum + account.balance, 0)
  const effectiveCoreValues = useMemo(
    () => syncCoreWithPrimaryAccount(syncCoreWithPrimary(coreValues, people), accounts, primary?.id ?? ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      coreValues,
      primary?.age,
      primary?.retirementAge,
      primary?.salary,
      primary?.id,
      totalAccountBalance,
      primaryAccount?.contributionMode,
      primaryAccount?.contributionPercentage,
    ],
  )

  // FIN-135: converted to engine-ready annual dollars here (the `toAssumptions`-adjacent wiring
  // boundary — ERD §4/§9), then debounced the same ~300ms as every other input
  // `useProjectionState` recalculates from, so a keystroke on the Retirement Spending tab doesn't
  // recompute the projection on every character. `undefined` (no goal, or an explicit 0) reaches
  // the hook unchanged and reproduces today's rate-driven behavior exactly — see this cross-
  // reference note on the ticket and `useProjectionState`'s own param doc comment.
  const retirementSpendingGoalAmount = useDebouncedValue(
    retirementSpendingGoalAnnualAmount(retirementSpendingValues),
    RECALCULATION_DEBOUNCE_MS,
  )

  // Fields update immediately for typing/validation feedback; the projection recalculation
  // itself is debounced ~300ms per FIN-9's notes, and "pauses" — keeps showing the last valid
  // result — while a field is out of range. See useProjectionState for the full behavior.
  const { rows, error, projectedBalanceAtRetirement, assumptions, debouncedCore, debouncedAdvanced, events } =
    useProjectionState(
      effectiveCoreValues,
      advancedValues,
      RECALCULATION_DEBOUNCE_MS,
      people,
      accounts,
      retirementSpendingGoalAmount,
    )

  // Persists once per settled (debounced) change, riding useProjectionState's existing ~300ms
  // debounce rather than introducing a second one (ERD §6.1). Fires once on mount too (the
  // debounced values equal the just-loaded initial state) — a harmless redundant first write,
  // not worth guarding against.
  // Debounced the same way `useProjectionState` debounces core/advanced (RECALCULATION_DEBOUNCE_MS),
  // so a reset's synchronous `setPeople` doesn't re-persist before `clearAssumptions()`'s effect
  // has had a chance to take hold, the same reasoning that already applies to debouncedCore/
  // debouncedAdvanced below.
  const debouncedPeople = useDebouncedValue(people, RECALCULATION_DEBOUNCE_MS)
  const debouncedAccounts = useDebouncedValue(accounts, RECALCULATION_DEBOUNCE_MS)
  // FIN-135: same debounce cadence as `debouncedPeople`/`debouncedAccounts` above — persists the
  // raw entered value + unit (round-trip-safe, ERD §4), not the converted annual amount.
  const debouncedRetirementSpendingValues = useDebouncedValue(retirementSpendingValues, RECALCULATION_DEBOUNCE_MS)

  useEffect(() => {
    saveAssumptions(debouncedCore, debouncedAdvanced, debouncedPeople, debouncedAccounts, debouncedRetirementSpendingValues)
  }, [debouncedCore, debouncedAdvanced, debouncedPeople, debouncedAccounts, debouncedRetirementSpendingValues])

  // Bug fix (FIN-132): the debounced save above only fires once the ~300ms debounce settles.
  // `App.tsx` renders Plan/Calculators as a ternary, so navigating away from Plan fully
  // *unmounts* PlanSection — which cancels `useDebouncedValue`'s pending `setTimeout` in its own
  // unmount cleanup before it can ever update `debouncedPeople`/`debouncedAccounts`/etc. Any edit
  // made within that debounce window (e.g. typing a new contribution %, then immediately
  // switching to Calculators) was silently discarded and never reached localStorage — reproduced
  // live: edit an account's contribution, navigate to Calculators before 300ms elapses, and
  // "Pull from my plan" pulls the stale pre-edit value.
  //
  // This ref mirrors the latest (non-debounced) values on every render, and a separate
  // mount-only effect flushes it straight to `saveAssumptions` from its cleanup — which React
  // runs synchronously during unmount, before the debounce's own cleanup has a chance to lose
  // the pending update. `saveAssumptions` is cheap/synchronous (plain localStorage write) so an
  // unmount-time call is safe.
  const latestForFlushRef = useRef({
    core: effectiveCoreValues,
    advanced: advancedValues,
    people,
    accounts,
    retirementSpending: retirementSpendingValues,
  })
  latestForFlushRef.current = {
    core: effectiveCoreValues,
    advanced: advancedValues,
    people,
    accounts,
    retirementSpending: retirementSpendingValues,
  }
  useEffect(() => {
    return () => {
      const latest = latestForFlushRef.current
      saveAssumptions(latest.core, latest.advanced, latest.people, latest.accounts, latest.retirementSpending)
    }
  }, [])

  // FIN-117 PM/Eng addendum round 2: confirming PeopleTab's cascade-delete dialog removes the
  // spouse from `people` — this wrapper also removes any account(s) that spouse owned, so no
  // orphaned account (owner deleted, account left behind) can result. Detects a removal by diff
  // against the previous `people`, rather than requiring PeopleTab to know about Accounts at all.
  const handlePeopleChange = (updatedPeople: Person[]) => {
    const remainingIds = new Set(updatedPeople.map((person) => person.id))
    const removedIds = people.filter((person) => !remainingIds.has(person.id)).map((person) => person.id)
    if (removedIds.length > 0) {
      setAccounts((prev) => prev.filter((account) => !removedIds.includes(account.ownerId)))
    }
    setPeople(updatedPeople)
  }

  const handleReset = () => {
    setIsResetConfirmOpen(true)
  }

  const handleConfirmReset = () => {
    setIsResetConfirmOpen(false)
    clearAssumptions()
    setCoreValues(DEFAULT_CORE_VALUES)
    setAdvancedValues(DEFAULT_ADVANCED_VALUES)
    const resetPrimary = createPrimaryPerson(DEFAULT_CORE_VALUES)
    setPeople([resetPrimary])
    setAccounts(seedAccounts(undefined, resetPrimary.id, DEFAULT_CORE_VALUES))
    setRetirementSpendingValues(DEFAULT_RETIREMENT_SPENDING_VALUES)
  }

  const handleCancelReset = () => {
    setIsResetConfirmOpen(false)
  }

  const successRateValue =
    successRate === null ? 'Run a stress test to see this' : formatPercent(successRate)

  // Default the chart/detail panel to the retirement year rather than the last year of the
  // full horizon — that's the year people care about most on load. Falls back to the last row
  // if, for some reason, no row's age matches (e.g. retirement age outside the horizon).
  const retirementRow = rows.find((row) => row.age === effectiveCoreValues.retirementAge) ?? rows.at(-1)

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
    effectiveCoreValues.currentAge < 65 && 65 <= PLANNING_HORIZON_END_AGE
      ? MEDICARE_PART_B_EVENT.startAge
      : undefined

  // FIN-114 added a spouse Medicare event to `events` (via useProjectionState) but never gave
  // it a chart marker — read its startAge straight from `events` (the single source of truth
  // per useProjectionState's own doc comment) rather than recomputing the age-offset math here.
  // Same suppression rule as the primary marker: only show it if it actually lands on a
  // plotted row.
  const spouseMedicareEvent = events.find(
    (event): event is Extract<PlanEvent, { type: 'recurringCost' }> =>
      event.type === 'recurringCost' && event.id === 'medicareSpousePartB',
  )
  const spouseMedicareStartAge =
    spouseMedicareEvent && rows.some((row) => row.age === spouseMedicareEvent.startAge)
      ? spouseMedicareEvent.startAge
      : undefined

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
                  <StatTile
                    label="Current investment balance"
                    value={formatCurrency(effectiveCoreValues.initialBalance)}
                  />
                  <StatTile
                    label={`Projected balance at ${effectiveCoreValues.retirementAge}`}
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
                    retirementAge={effectiveCoreValues.retirementAge}
                    medicareStartAge={medicareStartAge}
                    spouseMedicareStartAge={spouseMedicareStartAge}
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
                        {/* FIN-116: real People tab — pre-loaded primary Person, "+ Spouse"
                          * button, per-person name/age/retirement age/salary fields.
                          * FIN-117's bug-fix round removed `CoreInputsForm` from here entirely —
                          * its last two fields (initialBalance/annualContributionRatePercent)
                          * moved to the primary's Account on the Accounts tab.
                          * FIN-119: AdvancedAssumptionsForm moved out to the Rates sub-tab
                          * below — People now only hosts PeopleTab + the Reset control. */}
                        <PeopleTab people={people} onChange={handlePeopleChange} accounts={accounts} />
                        <Button variant="secondary" onClick={handleReset}>
                          Reset to defaults
                        </Button>
                      </>
                    ) : null}

                    {profileTab === 'accounts' ? (
                      <AccountsTab accounts={accounts} people={people} onChange={setAccounts} />
                    ) : null}

                    {profileTab === 'rates' ? (
                      <>
                        {/* FIN-119: Advanced Assumptions (stock/bond allocation, return
                          * assumptions, inflation, etc.) moved here from the People tab — pure
                          * relocation, no new fields, no behavior change, no storage schema
                          * change. Replaces the FIN-115 "Coming soon." stub. AdvancedAssumptionsForm
                          * itself no longer titles this content (it dropped its
                          * CollapsibleSection "Advanced assumptions" summary along with the
                          * relocation) — this heading replaces that, matching the same static
                          * `<h3>`-titled-to-the-nav-label pattern PeopleTab/AccountsTab already
                          * use for their own sub-tab content, rather than inventing a new one. */}
                        <h3 className="profileSubHeading">Rates</h3>
                        <AdvancedAssumptionsForm values={advancedValues} onChange={setAdvancedValues} />
                      </>
                    ) : null}

                    {profileTab === 'retirement-spending' ? (
                      <RetirementSpendingTab
                        values={retirementSpendingValues}
                        onChange={setRetirementSpendingValues}
                        assumptions={assumptions}
                        rows={rows}
                        hasSpouse={hasSpouse}
                      />
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
