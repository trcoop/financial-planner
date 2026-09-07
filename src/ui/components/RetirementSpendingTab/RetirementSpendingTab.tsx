import { useMemo } from 'react'
import type { PlanAssumptions, PlanEvent, PortfolioAllocation, ProjectionRow } from '../../../engine'
import { computeDepletionGuidance } from '../../../engine/retirementSolver'
import { MEDICARE_PART_B_EVENT } from '../../medicareEvent'
import { formatCurrency, formatPercent } from '../../utils/format'
import { Button } from '../Button/Button'
import { NumberField } from '../NumberField/NumberField'
import { StatTile } from '../StatTile/StatTile'
import { Tooltip } from '../Tooltip/Tooltip'
import { ToggleGroup } from '../InvestmentCalculator/ToggleGroup'
import {
  generalAmountError,
  medicareAmountError,
  retirementSpendingGoalAnnualAmount,
  type RetirementSpendingValues,
} from './RetirementSpendingGoal'
import styles from './RetirementSpendingTab.module.css'

const FREQUENCY_OPTIONS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'annual', label: 'Annual' },
]

/** Rounds a unit-converted dollar amount to the cent — floating-point `* 12` / `/ 12` round-trips
 * otherwise drift (e.g. `60000 / 12 * 12 !== 60000`), which would visibly disagree with what the
 * user typed after a couple of toggle flips. */
function roundToCents(value: number): number {
  return Math.round(value * 100) / 100
}

interface RetirementSpendingTabProps {
  values: RetirementSpendingValues
  onChange: (values: RetirementSpendingValues) => void
  /** The fully-composed `PlanAssumptions` object — the same one `PlanSection.tsx` already builds
   * and passes to `runProjection`/`StressTestSection` — not just the Rates tab's own values.
   * This is how `assumptions.planningHorizonEndAge`/`inflationRate`/`annualReturnRate` reach the
   * on-track readout below without this tab re-collecting them (ERD §16). */
  assumptions: PlanAssumptions
  /** The plan's current projection rows (already goal-driven when a goal is set, via this same
   * tab's own wiring into `useProjectionState` at the `PlanSection.tsx` call site) — used only for
   * the "Plan depleted at age X" callout's inline derivation (ERD §5/§11: no new engine field, no
   * standalone helper file). */
  rows: ProjectionRow[]
  /** The same plan events `PlanSection.tsx` passes to `runProjection` for `rows` above (FIN-118
   * Medicare et al.) — threaded through so the FIN-142 depletion guidance below re-runs the real
   * plan engine with the same events, not a simplified/eventless re-derivation. Defaults to `[]`
   * for callers (and existing tests) that don't set any. */
  events?: PlanEvent[]
  /** The plan's stock/bond allocation, same shape `StressTestSection` takes — threaded through so
   * the FIN-142 guidance solver's own Monte Carlo re-runs simulate the same portfolio the rest of
   * the app does, not a hardcoded default. */
  allocation: PortfolioAllocation
  /** The plan's Monte Carlo success rate (0-100), lifted from `StressTestSection` at the
   * `PlanSection.tsx` call site (`onSuccessRateChange`) — `null` until the user has run a stress
   * test at least once this session. FIN-142's redesign: this tab's on-track readout shows this
   * SAME figure (not a separate, simplified accumulation-model calculation) so it can never
   * disagree with the guidance callout below, which is solved against this same Monte Carlo
   * threshold. */
  successRate: number | null
  /** Whether `successRate` is stale relative to the plan's current inputs (lifted from
   * `StressTestSection` via `onStaleChange`, same as `successRate` above) — drives the "Re-run
   * stress test" action on the on-track stat tile, same affordance the Projection tab's own
   * "Chance of success" tile already has. */
  isStressTestStale: boolean
  /** Triggers a stress test re-run (imperative handle on `StressTestSection`, same call
   * `PlanSection.tsx`'s own "Re-run stress test" action makes) — wired to the stat tile's action
   * below when `isStressTestStale` is true. */
  onRunStressTest: () => void
  /** Whether a spouse `Person` currently exists — gates the spouse Medicare field's presence in
   * the DOM entirely (not disabled/greyed), matching the PRD's per-person exception. */
  hasSpouse: boolean
}

/**
 * FIN-135: the fourth Profile sub-tab (People | Accounts | Rates | Retirement Spending). Collects
 * a household spending goal (monthly or annual, today's dollars, round-trip-safe per ERD §4) plus
 * itemized Medicare overrides, and shows a read-only on-track readout + depletion callout driven
 * by the shared `retirementNumber` engine module (ERD §5/§8's shared-module assertion — the same
 * function the standalone Know Your Number calculator uses, not a re-implementation).
 *
 * No inflation rate / return rate / life expectancy inputs here — those are read from
 * `assumptions` (sourced from the Rates tab), never re-collected (AC).
 */
export function RetirementSpendingTab({
  values,
  onChange,
  assumptions,
  rows,
  events = [],
  allocation,
  successRate,
  isStressTestStale,
  onRunStressTest,
  hasSpouse,
}: RetirementSpendingTabProps) {
  const unit = values.generalAmountUnit ?? 'monthly'
  const amount = values.generalAmount ?? 0

  const handleAmountChange = (value: number) => {
    onChange({ ...values, generalAmount: value, generalAmountUnit: unit })
  }

  const handleUnitChange = (nextUnitValue: string) => {
    const nextUnit = nextUnitValue as 'monthly' | 'annual'
    if (nextUnit === unit) return
    // Converts the displayed amount so the real spending goal is preserved across the toggle —
    // switching from $5,000/mo to Annual shows $60,000, not a re-labeled $5,000/yr.
    const convertedAmount = roundToCents(nextUnit === 'annual' ? amount * 12 : amount / 12)
    onChange({ ...values, generalAmount: convertedAmount, generalAmountUnit: nextUnit })
  }

  const goalAnnualAmount = retirementSpendingGoalAnnualAmount(values)

  // ERD §5/§11: inline derivation, no new engine field, no standalone helper file. Informational
  // only (see `retirementSolver.ts`'s `depletedAtAge` doc comment) — a single deterministic
  // path's depletion age, shown alongside the Monte Carlo-driven guidance below, not the thing
  // that gates it. The latch in `clampRuin` guarantees this is the FIRST such row once found; the
  // age >= retirementAge guard is defensive-but-harmless (a pre-retirement endingBalance of
  // exactly 0 isn't realistic here).
  const depletedAtAge = rows.find((row) => row.endingBalance === 0 && row.age >= assumptions.retirementAge)?.age

  // FIN-142 (redesign): "on track" here means the same Monte Carlo success-rate bar as the rest
  // of the app (`StressTestSection`, the Projection tab's "Chance of success" tile) — see
  // `retirementSolver.ts`'s module doc comment for why a deterministic depletion check isn't the
  // same question. Runs its own low-precision Monte Carlo search independently of whether the
  // user has run a full stress test yet (`successRate`/`isStressTestStale` below are a SEPARATE,
  // reused figure for the stat tile, not an input to this search) — memoized on the plan's
  // (already-debounced, per `useProjectionState`) `assumptions`/`events`/`allocation` so it's not
  // recomputed on every keystroke.
  const guidance = useMemo(
    () => computeDepletionGuidance({ assumptions, events, allocation }),
    [assumptions, events, allocation],
  )

  return (
    <div className={styles.tab}>
      <h3 className={styles.heading}>Retirement Spending</h3>

      <div className={styles.fieldRow}>
        <NumberField
          label="Expected household expenses (today's dollars)"
          value={amount}
          onChange={handleAmountChange}
          min={0}
          max={unit === 'annual' ? 12_000_000 : 1_000_000}
          prefix="$"
          error={generalAmountError(amount, unit)}
        />
        <ToggleGroup label="Spending goal frequency" value={unit} onChange={handleUnitChange} options={FREQUENCY_OPTIONS} />
      </div>

      <div className={styles.medicareSection}>
        <h4 className={styles.subheading}>Medicare Part B</h4>
        <div className={styles.fieldRow}>
          <div className={styles.medicareField}>
            <NumberField
              label="Medicare Part B (you)"
              value={values.primaryMedicareAnnualAmount ?? MEDICARE_PART_B_EVENT.annualAmount}
              onChange={(value) => onChange({ ...values, primaryMedicareAnnualAmount: value })}
              min={0}
              max={100_000}
              prefix="$"
              error={medicareAmountError(values.primaryMedicareAnnualAmount ?? MEDICARE_PART_B_EVENT.annualAmount)}
              labelAdornment={
                <Tooltip label="Why this Medicare Part B amount?">
                  CMS's current standard premium: {formatCurrency(MEDICARE_PART_B_EVENT.annualAmount)}/yr
                </Tooltip>
              }
            />
          </div>
          {hasSpouse && (
            <div className={styles.medicareField}>
              <NumberField
                label="Medicare Part B (spouse)"
                value={values.spouseMedicareAnnualAmount ?? MEDICARE_PART_B_EVENT.annualAmount}
                onChange={(value) => onChange({ ...values, spouseMedicareAnnualAmount: value })}
                min={0}
                max={100_000}
                prefix="$"
                error={medicareAmountError(values.spouseMedicareAnnualAmount ?? MEDICARE_PART_B_EVENT.annualAmount)}
                labelAdornment={
                  <Tooltip label="Why this Medicare Part B amount?">
                    CMS's current standard premium: {formatCurrency(MEDICARE_PART_B_EVENT.annualAmount)}/yr
                  </Tooltip>
                }
              />
            </div>
          )}
        </div>
      </div>

      {/* `statTiles` is the app-global grid class (App.css) the Projection tab's own StatTile
        * row already uses — reused here rather than duplicating its responsive grid rules in
        * this component's own CSS module. */}
      <div className="statTiles">
        {goalAnnualAmount !== undefined ? (
          // FIN-142 (redesign): reuses the SAME `successRate` figure `StressTestSection`
          // computes (lifted up through `PlanSection.tsx`, same as the Projection tab's own
          // "Chance of success" tile) rather than a second, independent Monte Carlo run or the
          // old `retirementNumber.ts`-driven "Short by $X" readout — one on-track computation
          // path, reused, so this tile and the guidance callout below can never disagree (ERD
          // reuse principle; CLAUDE.md component/logic reuse). Same "not yet run"/stale handling
          // as the Projection tab tile: a placeholder value until the user runs a stress test at
          // least once, then a "Re-run stress test" action when inputs have since changed.
          <StatTile
            label="Chance of success"
            value={successRate === null ? 'Run a stress test to see this' : formatPercent(successRate)}
            isPlaceholder={successRate === null}
            action={
              isStressTestStale && successRate !== null ? (
                <Button variant="secondary" onClick={onRunStressTest}>
                  Re-run stress test
                </Button>
              ) : undefined
            }
          />
        ) : (
          <StatTile label="Status" value="Set a spending goal above to see whether you're on track." isPlaceholder />
        )}
      </div>

      {guidance.needsGuidance && (
        <div className={styles.depletedCallout}>
          <p className={styles.depletedHeadline}>
            {depletedAtAge !== undefined ? `Plan depleted at age ${depletedAtAge}` : "This plan isn't on track"}
          </p>
          {guidance.extraYears?.status === 'found' && (
            <p className={styles.depletedSuggestion}>
              You need to work {guidance.extraYears.extraYears} more year{guidance.extraYears.extraYears === 1 ? '' : 's'} (to
              age {guidance.extraYears.retirementAge}) with your current savings rate.
            </p>
          )}
          {guidance.extraContribution?.status === 'found' && (
            <p className={styles.depletedSuggestion}>
              Save {formatCurrency(guidance.extraContribution.extraMonthlyContribution)} more per month to stay on track to
              retire at {assumptions.retirementAge}.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
