import type { PlanAssumptions, ProjectionRow } from '../../../engine'
import { InvalidRetirementNumberInputError, calculateRetirementNumber, type RetirementNumberResult } from '../../../engine/retirementNumber'
import { MEDICARE_PART_B_EVENT } from '../../medicareEvent'
import { formatCurrency } from '../../utils/format'
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

/** Turns a `RetirementNumberResult` into the tab's one-line status text. */
function statusText(result: RetirementNumberResult): string {
  switch (result.status) {
    case 'onTrack':
      return 'On track'
    case 'shortBy':
      return `Short by ${formatCurrency(result.shortfallAmount)}`
    case 'couldRetireEarlier':
      return `Could retire at age ${result.earliestAge}`
  }
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
export function RetirementSpendingTab({ values, onChange, assumptions, rows, hasSpouse }: RetirementSpendingTabProps) {
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

  let retirementNumberResult: RetirementNumberResult | undefined
  if (goalAnnualAmount !== undefined) {
    try {
      retirementNumberResult = calculateRetirementNumber({
        currentAge: assumptions.currentAge,
        retirementAge: assumptions.retirementAge,
        desiredMonthlySpend: goalAnnualAmount / 12,
        currentBalance: assumptions.initialBalance,
        // Mirrors `computeIncome`'s (pipeline.ts) own pre-retirement contribution formula — the
        // plan's actual current savings rate, not a re-collected input.
        annualContribution: assumptions.currentAnnualIncome * assumptions.annualContributionRate + (assumptions.primaryFixedContribution ?? 0),
        inflationRate: assumptions.inflationRate,
        annualReturnRate: assumptions.annualReturnRate,
        lifeExpectancy: assumptions.planningHorizonEndAge,
      })
    } catch (error) {
      // Defensive only: a malformed plan (e.g. retirementAge before currentAge) shouldn't crash
      // this tab — it silently shows no readout instead of surfacing an engine error here.
      if (!(error instanceof InvalidRetirementNumberInputError)) throw error
      retirementNumberResult = undefined
    }
  }

  // ERD §5/§11: inline derivation, no new engine field, no standalone helper file. The latch in
  // `clampRuin` guarantees this is the FIRST such row once found; the age >= retirementAge guard
  // is defensive-but-harmless (a pre-retirement endingBalance of exactly 0 isn't realistic here).
  const depletedAtAge = rows.find((row) => row.endingBalance === 0 && row.age >= assumptions.retirementAge)?.age

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
        <p className={styles.hint}>Suggested from CMS's current standard premium — edit to override.</p>
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
            />
            <div className={styles.medicareFieldActions}>
              <Tooltip label="Why this Medicare Part B amount?">
                CMS's current standard premium: {formatCurrency(MEDICARE_PART_B_EVENT.annualAmount)}/yr
              </Tooltip>
              {values.primaryMedicareAnnualAmount !== undefined && (
                <Button
                  variant="secondary"
                  className={styles.resetButton}
                  onClick={() => onChange({ ...values, primaryMedicareAnnualAmount: undefined })}
                >
                  Reset to suggested amount
                </Button>
              )}
            </div>
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
              />
              <div className={styles.medicareFieldActions}>
                <Tooltip label="Why this Medicare Part B amount?">
                  CMS's current standard premium: {formatCurrency(MEDICARE_PART_B_EVENT.annualAmount)}/yr
                </Tooltip>
                {values.spouseMedicareAnnualAmount !== undefined && (
                  <Button
                    variant="secondary"
                    className={styles.resetButton}
                    onClick={() => onChange({ ...values, spouseMedicareAnnualAmount: undefined })}
                  >
                    Reset to suggested amount
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* `statTiles` is the app-global grid class (App.css) the Projection tab's own StatTile
        * row already uses — reused here rather than duplicating its responsive grid rules in
        * this component's own CSS module. */}
      <div className="statTiles">
        {retirementNumberResult ? (
          <>
            <StatTile label="Your number" value={formatCurrency(retirementNumberResult.targetBalance)} />
            <StatTile label="Projected balance" value={formatCurrency(retirementNumberResult.projectedBalance)} />
            <StatTile label="Status" value={statusText(retirementNumberResult)} />
          </>
        ) : (
          <StatTile label="Status" value="Set a spending goal above to see whether you're on track." isPlaceholder />
        )}
      </div>

      {depletedAtAge !== undefined && (
        <p className={styles.depletedCallout}>Plan depleted at age {depletedAtAge}</p>
      )}
    </div>
  )
}
