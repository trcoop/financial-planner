import { useState } from 'react'
import {
  runInvestmentProjection,
  InvalidInvestmentInputError,
  type CompoundingFrequency,
  type ContributionFrequency,
  type ContributionTiming,
  type InvestmentProjectionResult,
} from '../../../engine/investmentCalculator'
import { formatCurrency } from '../../utils/format'
import { Button } from '../Button/Button'
import { NumberField } from '../NumberField/NumberField'
import { SelectField } from '../SelectField/SelectField'
import { ToggleGroup } from './ToggleGroup'
import { StatTile } from '../StatTile/StatTile'
import { DonutChart } from '../DonutChart/DonutChart'
import { PercentileLineChart, type LineChartRow, type LineChartSeries } from '../PercentileLineChart/PercentileLineChart'
import styles from './InvestmentCalculator.module.css'

interface NumericValues {
  startingAmount: number
  annualGrowthRate: number
  contributionAmount: number
  years: number
}

interface FormValues extends NumericValues {
  compoundingFrequency: CompoundingFrequency
  contributionFrequency: ContributionFrequency
  contributionTiming: ContributionTiming
}

type RequiredField = 'startingAmount' | 'annualGrowthRate' | 'years'

/**
 * ERD §6: no default prefill decision was made for `annualGrowthRate` beyond "non-blocking,
 * decide during implementation" — 6% matches the ERD's own suggested value and NerdWallet/
 * SmartAsset's convention cited in the PRD.
 */
const DEFAULT_VALUES: FormValues = {
  startingAmount: 10_000,
  annualGrowthRate: 6,
  compoundingFrequency: 'annually',
  contributionAmount: 6_000,
  contributionFrequency: 'annually',
  contributionTiming: 'end',
  years: 20,
}

const COMPOUNDING_OPTIONS = [
  { value: 'annually', label: 'Annually' },
  { value: 'semiAnnually', label: 'Semi-annually' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'daily', label: 'Daily' },
]

const CONTRIBUTION_FREQUENCY_OPTIONS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'annually', label: 'Annually' },
]

const CONTRIBUTION_TIMING_OPTIONS = [
  { value: 'start', label: 'Start of period' },
  { value: 'end', label: 'End of period' },
]

const LINE_SERIES: LineChartSeries[] = [{ key: 'balance', label: 'Balance', color: 'var(--color-primary)' }]

interface FieldErrors {
  startingAmount?: string
  annualGrowthRate?: string
  contributionAmount?: string
  years?: string
}

/**
 * Client-side validation for immediate UX feedback, on top of (not instead of) the engine's own
 * validation (architecture.md convention). `blankFields` tracks which required inputs are
 * currently empty in the DOM — `NumberField` never surfaces a cleared field through its own
 * numeric `onChange` (by design, see its own test suite), so this component listens to its
 * additive `onTextChange` escape hatch to know when a field the user cleared should read as
 * "blank" rather than silently falling back to its last valid numeric value. Contribution amount
 * is deliberately excluded from "blank is an error" — PRD AC: blank/zero contribution is valid
 * and just means no contributions.
 */
function validateForm(values: FormValues, blankFields: ReadonlySet<RequiredField>): FieldErrors {
  const errors: FieldErrors = {}

  if (blankFields.has('startingAmount')) {
    errors.startingAmount = 'Enter a starting amount.'
  } else if (values.startingAmount < 0) {
    errors.startingAmount = 'Starting amount must be zero or more.'
  } else if (values.startingAmount > 100_000_000) {
    errors.startingAmount = 'Starting amount must be $100,000,000 or less.'
  }

  if (blankFields.has('annualGrowthRate')) {
    errors.annualGrowthRate = 'Enter a growth rate.'
  } else if (values.annualGrowthRate < -10 || values.annualGrowthRate > 30) {
    errors.annualGrowthRate = 'Growth rate must be between -10% and 30%.'
  }

  if (values.contributionAmount < 0) {
    errors.contributionAmount = 'Contribution amount must be zero or more.'
  } else if (values.contributionAmount > 1_000_000) {
    errors.contributionAmount = 'Contribution amount must be $1,000,000 or less.'
  }

  if (blankFields.has('years')) {
    errors.years = 'Enter a number of years.'
  } else if (!Number.isInteger(values.years)) {
    errors.years = 'Years must be a whole number.'
  } else if (values.years < 1 || values.years > 100) {
    errors.years = 'Years must be between 1 and 100.'
  }

  return errors
}

/**
 * Standalone investment-growth calculator (FIN-109). Owns its own form + results state; calls
 * `runInvestmentProjection` only on "Calculate" click — no live recalculation (two-tier
 * interaction pattern, matching `StressTestSection`). No dependency on the saved plan/projection
 * engine or app state (PRD Non-Goal #4) — every input it needs comes from its own form.
 */
export function InvestmentCalculator() {
  const [values, setValues] = useState<FormValues>(DEFAULT_VALUES)
  const [blankFields, setBlankFields] = useState<ReadonlySet<RequiredField>>(new Set())
  // True once "Calculate" has been clicked at least once — gates whether validation errors show
  // at all (no one should see an error before ever submitting). Once true, errors below are
  // recomputed fresh on every render from the current `values`/`blankFields` rather than cached
  // from the moment of the click, so a field's error clears itself the instant the user fixes it
  // — matching `CoreInputsForm`'s live-clearing convention instead of leaving a stale message on
  // screen until the next Calculate click (round-1 review finding).
  const [hasAttemptedCalculate, setHasAttemptedCalculate] = useState(false)
  // Set only by a genuine `runInvestmentProjection` throw — effectively unreachable today since
  // `validateForm`'s bounds mirror the engine's own (see the catch block below), kept as a
  // defensive fallback in case the two ever drift. Cleared on every input change so it can't
  // linger as a stale message either.
  const [engineError, setEngineError] = useState<string | null>(null)
  const [result, setResult] = useState<InvestmentProjectionResult | null>(null)

  const setNumericField = <K extends keyof NumericValues>(key: K, value: number) => {
    setValues((prev) => ({ ...prev, [key]: value }))
    setEngineError(null)
  }

  const setBlank = (key: RequiredField, isBlank: boolean) => {
    setEngineError(null)
    setBlankFields((prev) => {
      const alreadySet = prev.has(key)
      if (isBlank === alreadySet) return prev
      const next = new Set(prev)
      if (isBlank) next.add(key)
      else next.delete(key)
      return next
    })
  }

  const errors: FieldErrors = hasAttemptedCalculate ? validateForm(values, blankFields) : {}

  const handleCalculate = () => {
    setHasAttemptedCalculate(true)
    const fieldErrors = validateForm(values, blankFields)
    if (Object.keys(fieldErrors).length > 0) {
      setResult(null)
      return
    }

    try {
      const projection = runInvestmentProjection({
        startingAmount: values.startingAmount,
        annualGrowthRate: values.annualGrowthRate,
        compoundingFrequency: values.compoundingFrequency,
        contributionAmount: values.contributionAmount,
        contributionFrequency: values.contributionFrequency,
        contributionTiming: values.contributionTiming,
        years: values.years,
      })
      setEngineError(null)
      setResult(projection)
    } catch (error) {
      // The engine validates independently of the client-side checks above (architecture.md);
      // surface any failure it still finds as a generic top-level error rather than crashing.
      setResult(null)
      setEngineError(
        error instanceof InvalidInvestmentInputError
          ? error.message
          : 'Something went wrong calculating that projection.',
      )
    }
  }

  const chartRows: LineChartRow[] | null = result
    ? result.rows.map((row) => ({ year: row.year, values: { balance: row.balance } }))
    : null

  return (
    <section className={styles.calculator} aria-label="Investment calculator">
      <form
        className={styles.form}
        aria-label="Investment calculator inputs"
        onSubmit={(event) => {
          event.preventDefault()
          handleCalculate()
        }}
      >
        <NumberField
          label="Starting amount"
          value={values.startingAmount}
          onChange={(value) => setNumericField('startingAmount', value)}
          onTextChange={(text) => setBlank('startingAmount', text.trim() === '')}
          min={0}
          max={100_000_000}
          prefix="$"
          error={errors.startingAmount}
        />
        <NumberField
          label="Years"
          value={values.years}
          onChange={(value) => setNumericField('years', value)}
          onTextChange={(text) => setBlank('years', text.trim() === '')}
          min={1}
          max={100}
          step={1}
          error={errors.years}
        />
        <NumberField
          label="Growth rate"
          value={values.annualGrowthRate}
          onChange={(value) => setNumericField('annualGrowthRate', value)}
          onTextChange={(text) => setBlank('annualGrowthRate', text.trim() === '')}
          min={-10}
          max={30}
          step={0.1}
          suffix="%"
          error={errors.annualGrowthRate}
        />
        <SelectField
          label="Compounding frequency"
          value={values.compoundingFrequency}
          onChange={(value) => setValues((prev) => ({ ...prev, compoundingFrequency: value as CompoundingFrequency }))}
          options={COMPOUNDING_OPTIONS}
        />
        <NumberField
          label="Contribution amount"
          value={values.contributionAmount}
          onChange={(value) => setNumericField('contributionAmount', value)}
          onTextChange={(text) => {
            // Blank/zero contribution is explicitly valid (PRD AC) — a cleared field collapses
            // straight to 0 rather than being tracked as a required-but-missing error state.
            if (text.trim() === '') setNumericField('contributionAmount', 0)
          }}
          min={0}
          max={1_000_000}
          prefix="$"
          error={errors.contributionAmount}
        />
        <ToggleGroup
          label="Contribution frequency"
          value={values.contributionFrequency}
          onChange={(value) => setValues((prev) => ({ ...prev, contributionFrequency: value as ContributionFrequency }))}
          options={CONTRIBUTION_FREQUENCY_OPTIONS}
        />
        <ToggleGroup
          label="Contribution timing"
          value={values.contributionTiming}
          onChange={(value) => setValues((prev) => ({ ...prev, contributionTiming: value as ContributionTiming }))}
          options={CONTRIBUTION_TIMING_OPTIONS}
        />

        <Button type="submit" className={styles.calculateButton}>
          Calculate
        </Button>
      </form>

      {engineError && (
        <p role="alert" className={styles.engineError}>
          {engineError}
        </p>
      )}

      {result && chartRows && (
        <div className={styles.results}>
          <div className={styles.statRow}>
            <StatTile label="Final Balance" value={formatCurrency(result.finalBalance)} />
            <StatTile label="Total Contributions" value={formatCurrency(result.totalContributions)} />
            <StatTile label="Total Growth" value={formatCurrency(result.totalGrowth)} />
          </div>

          <div className={styles.chartRow}>
            <DonutChart
              title="Balance breakdown"
              // Real (unclamped) figures, including a negative Growth for a losing scenario
              // (annualGrowthRate's floor is -10%, so this is reachable) — clamping a negative
              // growth to $0 would silently misrepresent a loss as "no growth" in both the
              // legend text and the sum the wedges represent. `DonutChart` itself already skips
              // drawing a zero-or-negative-span wedge (see its own `endAngle > startAngle`
              // filter) while still listing every segment's real value in the legend, so a
              // negative Growth here still renders as "-$X" in the legend with no wedge, rather
              // than a misleading "$0".
              segments={[
                { label: 'Starting amount', value: values.startingAmount },
                { label: 'Contributions', value: result.totalContributions },
                { label: 'Growth', value: result.totalGrowth },
              ]}
            />

            <PercentileLineChart
              rows={chartRows}
              series={LINE_SERIES}
              title="Year-by-year balance"
              showLegend={false}
            />
          </div>
        </div>
      )}
    </section>
  )
}
