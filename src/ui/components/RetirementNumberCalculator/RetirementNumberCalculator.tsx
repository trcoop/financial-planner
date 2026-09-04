import { useState } from 'react'
import {
  calculateRetirementNumber,
  InvalidRetirementNumberInputError,
  type RetirementNumberResult,
} from '../../../engine/retirementNumber'
import { blendedPortfolioReturn } from '../../../engine'
import { loadAssumptions } from '../../../storage'
import { primaryPerson, type Person } from '../PeopleTab/Person'
import type { Account } from '../AccountsTab/Account'
import { formatCurrency } from '../../utils/format'
import { Button } from '../Button/Button'
import { NumberField } from '../NumberField/NumberField'
import { CollapsibleSection } from '../CollapsibleSection/CollapsibleSection'
import { StatTile } from '../StatTile/StatTile'
import { DEFAULT_ADVANCED_VALUES as SHARED_DEFAULT_ADVANCED_VALUES } from '../AdvancedAssumptionsForm/defaults'
import { retirementSpendingGoalAnnualAmount } from '../RetirementSpendingTab/RetirementSpendingGoal'
import styles from './RetirementNumberCalculator.module.css'

/**
 * Mirrors `PLANNING_HORIZON_END_AGE` (`src/ui/hooks/useProjectionState.ts`) — this app's fixed,
 * non-user-editable planning-horizon constant, which the ERD (§15) designates as this
 * calculator's `lifeExpectancy` source for both the standalone default and the "pull from my
 * plan" case (both agree on the same value today, so there is no separate pulled-vs-standalone
 * default to draw). Defined locally, matching `retirementNumber.ts`'s own `DEFAULT_LIFE_EXPECTANCY`,
 * rather than imported from `useProjectionState.ts` — this standalone, non-pipeline calculator has
 * no other reason to depend on that hook's import graph (engine pipeline, Medicare event wiring,
 * debounce hook) just for one constant.
 */
const PLANNING_HORIZON_END_AGE = 100

interface RequiredValues {
  currentAge: number
  retirementAge: number
  /** Today's dollars, monthly. */
  desiredMonthlySpend: number
  currentBalance: number
  /** Today's dollars, annual — the engine inflates this forward each accumulation year (see
   * FIN-132's ticket note); no UI-side inflation handling is needed here. */
  annualContribution: number
}

type RequiredField = keyof RequiredValues

interface AdvancedValues {
  /** Plain percentage (e.g. 2.5 for 2.5%), matching AdvancedAssumptionsForm's own convention. */
  inflationPercent: number
  safeWithdrawalRatePercent: number
  annualReturnPercent: number
  lifeExpectancy: number
}

type FormValues = RequiredValues & AdvancedValues

/** Every required field starts blank (AC: "no result shown and required fields are clearly
 * marked" on first open) — `NaN` is `NumberField`'s own contract for "render as empty text"
 * (see its `formatValue` helper), not a real value a user could reach through typing. */
const BLANK_REQUIRED_VALUES: RequiredValues = {
  currentAge: NaN,
  retirementAge: NaN,
  desiredMonthlySpend: NaN,
  currentBalance: NaN,
  annualContribution: NaN,
}

/**
 * Derived from the app's real shared defaults (`AdvancedAssumptionsForm/defaults.ts`'s
 * `DEFAULT_ADVANCED_VALUES`, imported here as `SHARED_DEFAULT_ADVANCED_VALUES`) rather than a
 * second hardcoded 6.8/2.5 — those two numbers are themselves just the blend of that file's
 * 8%/4%/70/30 stocks/bonds split (`blendedPortfolioReturn`, `src/engine/monteCarlo.ts`), so
 * hand-copying them here risked silently drifting from the shared defaults if that file ever
 * changes (FIN-132 review fix). `retirementNumber.ts`'s own `DEFAULT_ANNUAL_RETURN_RATE`/
 * `DEFAULT_INFLATION_RATE` are today's identical values for the same reason — see that file's
 * doc comment — but this component always passes its own value explicitly below, so the
 * engine's defaults never actually apply here; they exist only as that module's own standalone
 * fallback for other/future callers. */
const DEFAULT_ADVANCED_VALUES: AdvancedValues = {
  inflationPercent: SHARED_DEFAULT_ADVANCED_VALUES.inflationPercent,
  // Calculator-only rate (see `RetirementNumberInput.safeWithdrawalRate`'s doc comment in
  // `retirementNumber.ts`) — deliberately NOT derived from the shared
  // `withdrawalRatePercent` (3.9%), which is the main Plan's own, differently-calibrated
  // withdrawal rate; matches `retirementNumber.ts`'s own `DEFAULT_SAFE_WITHDRAWAL_RATE` (4%).
  safeWithdrawalRatePercent: 4,
  annualReturnPercent:
    blendedPortfolioReturn(
      {
        stocksPercent: SHARED_DEFAULT_ADVANCED_VALUES.stocksAllocationPercent,
        bondsPercent: 100 - SHARED_DEFAULT_ADVANCED_VALUES.stocksAllocationPercent,
      },
      SHARED_DEFAULT_ADVANCED_VALUES.annualReturnPercent / 100,
      SHARED_DEFAULT_ADVANCED_VALUES.bondReturnPercent / 100,
    ) * 100,
  lifeExpectancy: PLANNING_HORIZON_END_AGE,
}

const DEFAULT_VALUES: FormValues = { ...BLANK_REQUIRED_VALUES, ...DEFAULT_ADVANCED_VALUES }

const REQUIRED_FIELDS: RequiredField[] = [
  'currentAge',
  'retirementAge',
  'desiredMonthlySpend',
  'currentBalance',
  'annualContribution',
]

interface FieldErrors {
  currentAge?: string
  retirementAge?: string
  desiredMonthlySpend?: string
  currentBalance?: string
  annualContribution?: string
  inflationPercent?: string
  safeWithdrawalRatePercent?: string
  annualReturnPercent?: string
  lifeExpectancy?: string
}

/**
 * Client-side validation for immediate UX feedback, on top of (not instead of) the engine's own
 * validation (architecture.md convention, matching `InvestmentCalculator`'s own
 * `validateForm`). Bounds mirror `retirementNumber.ts`'s own checks where it has one (retirement
 * age not before current age, life expectancy not before retirement age, safe withdrawal rate in
 * (0%, 100%]); the rest are UI-only sanity caps, since the engine deliberately has no absolute
 * age/amount bounds of its own (ERD §12).
 */
function validateForm(values: FormValues, blankFields: ReadonlySet<RequiredField>): FieldErrors {
  const errors: FieldErrors = {}

  if (blankFields.has('currentAge')) {
    errors.currentAge = 'Enter your current age.'
  } else if (values.currentAge < 0 || values.currentAge > 120) {
    errors.currentAge = 'Current age must be between 0 and 120.'
  }

  if (blankFields.has('retirementAge')) {
    errors.retirementAge = 'Enter your target retirement age.'
  } else if (values.retirementAge < 0 || values.retirementAge > 120) {
    errors.retirementAge = 'Retirement age must be between 0 and 120.'
  } else if (!blankFields.has('currentAge') && values.retirementAge < values.currentAge) {
    errors.retirementAge = 'Retirement age must be at or after current age.'
  }

  if (blankFields.has('desiredMonthlySpend')) {
    errors.desiredMonthlySpend = 'Enter your desired monthly retirement spend.'
  } else if (values.desiredMonthlySpend < 0) {
    errors.desiredMonthlySpend = 'Desired monthly spend must be zero or more.'
  } else if (values.desiredMonthlySpend > 1_000_000) {
    errors.desiredMonthlySpend = 'Desired monthly spend must be $1,000,000 or less.'
  }

  if (blankFields.has('currentBalance')) {
    errors.currentBalance = 'Enter your current retirement account balance.'
  } else if (values.currentBalance < 0) {
    errors.currentBalance = 'Current balance must be zero or more.'
  } else if (values.currentBalance > 100_000_000) {
    errors.currentBalance = 'Current balance must be $100,000,000 or less.'
  }

  if (blankFields.has('annualContribution')) {
    errors.annualContribution = 'Enter your annual investment/contribution amount.'
  } else if (values.annualContribution < 0) {
    errors.annualContribution = 'Annual contribution must be zero or more.'
  } else if (values.annualContribution > 5_000_000) {
    errors.annualContribution = 'Annual contribution must be $5,000,000 or less.'
  }

  if (values.inflationPercent < -50 || values.inflationPercent > 100) {
    errors.inflationPercent = 'Inflation rate must be between -50% and 100%.'
  }

  if (values.safeWithdrawalRatePercent <= 0 || values.safeWithdrawalRatePercent > 100) {
    errors.safeWithdrawalRatePercent = 'Safe withdrawal rate must be greater than 0% and at most 100%.'
  }

  if (values.annualReturnPercent < -50 || values.annualReturnPercent > 100) {
    errors.annualReturnPercent = 'Expected annual return must be between -50% and 100%.'
  }

  if (values.lifeExpectancy < 0 || values.lifeExpectancy > 130) {
    errors.lifeExpectancy = 'Life expectancy must be between 0 and 130.'
  } else if (!blankFields.has('retirementAge') && values.lifeExpectancy < values.retirementAge) {
    errors.lifeExpectancy = 'Life expectancy must be at or after retirement age.'
  }

  return errors
}

/** An account's own annual contribution in dollars: `fixed`-mode reads `contributionFixed`
 * directly, `percentage`-mode is a share of the *owning Person's* salary (not the primary's) —
 * a spouse-owned percentage-mode account contributes against the spouse's own salary. If the
 * account's `ownerId` doesn't resolve to a real Person (shouldn't normally happen), the account
 * contributes $0 rather than throwing. Also guards against a non-finite result — unlike
 * `Account.ts`'s own `normalizeAccount`, `seedPeople` (`Person.ts`) does *not* repair a
 * persisted `Person`'s individual fields, so a schema-drifted or partially-migrated record
 * (e.g. a spouse saved before `salary` existed) can still reach here with `salary: undefined`;
 * without this guard that silently turns the sum into `NaN`, which `NumberField` then renders
 * as a blank field — indistinguishable from "pull" doing nothing at all. Used only by
 * `handlePullFromPlan` below — unlike `useProjectionState.ts`'s per-mode sums (which the engine
 * needs split by mode/owner for `AdditionalIncome`/`primaryContributionRate` wiring), this
 * calculator only needs one flat total across every account, so that shape isn't reused here. */
function accountAnnualContribution(account: Account, people: Person[]): number {
  const owner = people.find((person) => person.id === account.ownerId)
  if (!owner) return 0
  const amount =
    account.contributionMode === 'fixed'
      ? account.contributionFixed
      : (account.contributionPercentage / 100) * owner.salary
  return Number.isFinite(amount) ? amount : 0
}

/** The exactly-one headline the AC requires — never a probability/percentage. */
function describeResult(result: RetirementNumberResult, lifeExpectancy: number): string {
  switch (result.status) {
    case 'onTrack':
      return 'On track'
    case 'shortBy':
      if (result.onTrackAge !== undefined) {
        return `Short by ${formatCurrency(result.shortfallAmount)} — on track by age ${result.onTrackAge}`
      }
      return `Short by ${formatCurrency(result.shortfallAmount)} — not projected to catch up by age ${lifeExpectancy}`
    case 'couldRetireEarlier':
      return `Could retire at age ${result.earliestAge}`
  }
}

/**
 * Standalone "Retirement Number" calculator (FIN-132). Owns its own form + result state; calls
 * `calculateRetirementNumber` only on "Calculate" click — no live recalculation (two-tier
 * interaction pattern, matching `InvestmentCalculator`/`StressTestSection`). Fully standalone —
 * no dependency on the saved plan/projection engine (the ticket's "no dependency on a saved
 * plan" requirement) except for the strictly opt-in, read-only "Pull from my plan" prefill below,
 * which never writes back to storage.
 */
export function RetirementNumberCalculator() {
  const [values, setValues] = useState<FormValues>(DEFAULT_VALUES)
  const [blankFields, setBlankFields] = useState<ReadonlySet<RequiredField>>(new Set(REQUIRED_FIELDS))
  const [hasAttemptedCalculate, setHasAttemptedCalculate] = useState(false)
  // Set only by a genuine `calculateRetirementNumber` throw — effectively unreachable today since
  // `validateForm`'s bounds mirror the engine's own, kept as a defensive fallback in case the two
  // ever drift (matches `InvestmentCalculator`'s identical rationale).
  const [engineError, setEngineError] = useState<string | null>(null)
  const [result, setResult] = useState<RetirementNumberResult | null>(null)
  // Captured alongside `result` at calculate time so the "not projected to catch up by age X"
  // headline can't drift from the `lifeExpectancy` the result was actually computed with, even
  // if the user edits the field afterward without recalculating.
  const [resultLifeExpectancy, setResultLifeExpectancy] = useState<number | null>(null)
  // Lazily read once on mount — a plan saved *after* this calculator opens still won't show the
  // button until the calculator is reopened, matching the "read-only, one-time" (not a live
  // binding) contract the ticket specifies for this feature as a whole.
  const [hasPlan] = useState(() => loadAssumptions() !== undefined)

  const setNumericField = <K extends keyof FormValues>(key: K, value: number) => {
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
      const computed = calculateRetirementNumber({
        currentAge: values.currentAge,
        retirementAge: values.retirementAge,
        desiredMonthlySpend: values.desiredMonthlySpend,
        currentBalance: values.currentBalance,
        annualContribution: values.annualContribution,
        inflationRate: values.inflationPercent / 100,
        safeWithdrawalRate: values.safeWithdrawalRatePercent / 100,
        annualReturnRate: values.annualReturnPercent / 100,
        lifeExpectancy: values.lifeExpectancy,
      })
      setEngineError(null)
      setResult(computed)
      setResultLifeExpectancy(values.lifeExpectancy)
    } catch (error) {
      // The engine validates independently of the client-side checks above (architecture.md);
      // surface any failure it still finds as a generic top-level error rather than crashing.
      setResult(null)
      setResultLifeExpectancy(null)
      setEngineError(
        error instanceof InvalidRetirementNumberInputError
          ? error.message
          : 'Something went wrong calculating your number.',
      )
    }
  }

  // Read-only, one-time prefill (never a live binding, never writes back to `people`/`accounts`/
  // `assumptions` — ERD §5/§12): currentAge/retirementAge from the primary Person, currentBalance
  // from summing every account's balance (mirrors `PlanSection.tsx`'s `totalAccountBalance`
  // pattern), annualContribution from summing every account's own dollar contribution (across
  // every owner, not just the primary — a spouse's accounts count too), lifeExpectancy from the
  // app's planning-horizon constant. `desiredMonthlySpend` is pulled from the household spending
  // goal set on the Retirement Spending profile tab (`persisted.retirementSpending`), normalized to
  // an annual figure via `retirementSpendingGoalAnnualAmount` and converted to monthly here (same
  // convention `RetirementSpendingTab.tsx` uses when deriving its own `desiredMonthlySpend`) — if no
  // goal has ever been set, the field is left untouched, same as the other pulled fields when their
  // source data is absent.
  const handlePullFromPlan = () => {
    const persisted = loadAssumptions()
    if (!persisted) return

    const primary = primaryPerson(persisted.people)
    const totalBalance = persisted.accounts.reduce((sum, account) => sum + account.balance, 0)
    const totalContribution = persisted.accounts.reduce(
      (sum, account) => sum + accountAnnualContribution(account, persisted.people),
      0,
    )
    const goalAnnualAmount = retirementSpendingGoalAnnualAmount(persisted.retirementSpending)
    const monthlySpend =
      goalAnnualAmount !== undefined ? Math.round((goalAnnualAmount / 12) * 100) / 100 : undefined

    setValues((prev) => ({
      ...prev,
      currentAge: primary ? primary.age : prev.currentAge,
      retirementAge: primary ? primary.retirementAge : prev.retirementAge,
      desiredMonthlySpend: monthlySpend !== undefined ? monthlySpend : prev.desiredMonthlySpend,
      currentBalance: totalBalance,
      annualContribution: totalContribution,
      lifeExpectancy: PLANNING_HORIZON_END_AGE,
    }))
    setBlankFields((prev) => {
      const next = new Set(prev)
      if (primary) {
        next.delete('currentAge')
        next.delete('retirementAge')
      }
      if (monthlySpend !== undefined) {
        next.delete('desiredMonthlySpend')
      }
      next.delete('currentBalance')
      next.delete('annualContribution')
      return next
    })
    setEngineError(null)
  }

  return (
    <section className={styles.calculator} aria-label="Retirement Number calculator">
      {hasPlan && (
        <div className={styles.pullRow}>
          <Button type="button" onClick={handlePullFromPlan}>
            Pull from my plan
          </Button>
        </div>
      )}

      <form
        className={styles.form}
        aria-label="Retirement Number calculator inputs"
        onSubmit={(event) => {
          event.preventDefault()
          handleCalculate()
        }}
      >
        <NumberField
          label="Current age"
          value={values.currentAge}
          onChange={(value) => setNumericField('currentAge', value)}
          onTextChange={(text) => setBlank('currentAge', text.trim() === '')}
          min={0}
          max={120}
          step={1}
          error={errors.currentAge}
        />
        <NumberField
          label="Target retirement age"
          value={values.retirementAge}
          onChange={(value) => setNumericField('retirementAge', value)}
          onTextChange={(text) => setBlank('retirementAge', text.trim() === '')}
          min={0}
          max={120}
          step={1}
          error={errors.retirementAge}
        />
        <NumberField
          label="Desired monthly retirement spend (today's dollars)"
          value={values.desiredMonthlySpend}
          onChange={(value) => setNumericField('desiredMonthlySpend', value)}
          onTextChange={(text) => setBlank('desiredMonthlySpend', text.trim() === '')}
          min={0}
          max={1_000_000}
          prefix="$"
          error={errors.desiredMonthlySpend}
        />
        <NumberField
          label="Current retirement account balance"
          value={values.currentBalance}
          onChange={(value) => setNumericField('currentBalance', value)}
          onTextChange={(text) => setBlank('currentBalance', text.trim() === '')}
          min={0}
          max={100_000_000}
          prefix="$"
          error={errors.currentBalance}
        />
        <div>
          <NumberField
            label="Annual investment/contribution amount"
            value={values.annualContribution}
            onChange={(value) => setNumericField('annualContribution', value)}
            onTextChange={(text) => setBlank('annualContribution', text.trim() === '')}
            min={0}
            max={5_000_000}
            prefix="$"
            error={errors.annualContribution}
          />
          <p className={styles.hint}>
            Today&rsquo;s dollars — automatically adjusted for inflation each year until retirement.
          </p>
        </div>

        <CollapsibleSection summary="Advanced assumptions" className={styles.advancedSection}>
          <div className={styles.advanced}>
            <NumberField
              label="Inflation rate"
              value={values.inflationPercent}
              onChange={(value) => setNumericField('inflationPercent', value)}
              min={-50}
              max={100}
              step={0.1}
              suffix="%"
              error={errors.inflationPercent}
            />
            <NumberField
              label="Safe withdrawal rate"
              value={values.safeWithdrawalRatePercent}
              onChange={(value) => setNumericField('safeWithdrawalRatePercent', value)}
              min={0.1}
              max={100}
              step={0.1}
              suffix="%"
              error={errors.safeWithdrawalRatePercent}
            />
            <NumberField
              label="Expected annual return"
              value={values.annualReturnPercent}
              onChange={(value) => setNumericField('annualReturnPercent', value)}
              min={-50}
              max={100}
              step={0.1}
              suffix="%"
              error={errors.annualReturnPercent}
            />
            <NumberField
              label="Life expectancy"
              value={values.lifeExpectancy}
              onChange={(value) => setNumericField('lifeExpectancy', value)}
              min={0}
              max={130}
              step={1}
              error={errors.lifeExpectancy}
            />
          </div>
        </CollapsibleSection>

        <Button type="submit" className={styles.calculateButton}>
          Calculate
        </Button>
      </form>

      {engineError && (
        <p role="alert" className={styles.engineError}>
          {engineError}
        </p>
      )}

      {result && (
        <div className={styles.results}>
          <p className={styles.headline} data-status={result.status}>
            {describeResult(result, resultLifeExpectancy ?? values.lifeExpectancy)}
          </p>
          <div className={styles.statRow}>
            <StatTile label="Your number" value={formatCurrency(result.targetBalance)} />
            <StatTile label="Projected balance" value={formatCurrency(result.projectedBalance)} />
            {result.status === 'shortBy' && result.requiredExtraAnnualContribution !== undefined && (
              <StatTile
                label="Extra needed per year to close the gap"
                value={formatCurrency(result.requiredExtraAnnualContribution)}
              />
            )}
          </div>
        </div>
      )}
    </section>
  )
}
