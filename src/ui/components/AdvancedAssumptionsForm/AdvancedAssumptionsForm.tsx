import { realReturn } from '../../../engine'
import { formatPercent } from '../../utils/format'
import { NumberField } from '../NumberField/NumberField'
import { Tooltip } from '../Tooltip/Tooltip'
import tooltipStyles from '../Tooltip/Tooltip.module.css'
import { SAFE_WITHDRAWAL_RATES } from './safeWithdrawalRates'
import { SUGGESTED_RETURN_RATES } from './suggestedReturnRates'
import { ADVANCED_FIELD_RANGES, rangeError } from './validation'
import styles from './AdvancedAssumptionsForm.module.css'

export interface AdvancedAssumptionValues {
  /** Plain percentage (e.g. 3 for 3%), not a 0-1 fraction — matches the field's display. */
  annualRaisePercent: number
  /** Stocks' expected COMPOUND (geometric) return — the rate an investor actually experiences,
   * which is how a user reads "expected annual return" and how ProjectionLab's equivalent field
   * behaves. FIN-64: feeds only the Tier 1 Plan projection's single compounding rate (blended
   * with `bondReturnPercent` by `stocksAllocationPercent` via `blendedPortfolioReturn`) — see
   * `useProjectionState.ts`. FIN-65 removed a variance-drag adjustment that had been applied on
   * top of it; the field was already geometric, so the drag double-counted. The Tier 2
   * Monte Carlo stress test does not read this; its default `returnModel: 'historical'`
   * block-bootstraps real 1928-2025 returns instead (see `DEFAULT_RETURN_ASSUMPTIONS`'s doc
   * comment in `src/engine/monteCarlo.ts`), by design — a forward-looking, conservative return
   * assumption is right for a single deterministic line, but would understate Monte Carlo's
   * own sequence-of-returns risk if fed into it directly. */
  annualReturnPercent: number
  inflationPercent: number
  withdrawalRatePercent: number
  /** The stock/bond mix (FIN-56) used both by `runMonteCarloTrials`' allocation and (FIN-64) by
   * the Tier 1 projection's `blendedPortfolioReturn` blend. Bonds = `100 -
   * stocksAllocationPercent`, so this one field fully determines the `PortfolioAllocation`
   * passed to both — see `App.tsx` and `useProjectionState.ts`. */
  stocksAllocationPercent: number
  /** Bonds' expected COMPOUND (geometric) return (FIN-57), same treatment as
   * `annualReturnPercent` (FIN-64/65): feeds only the Tier 1 projection's blended rate — not
   * the Monte Carlo stress test, which block-bootstraps real historical returns instead. */
  bondReturnPercent: number
}

interface FieldSpec {
  key: keyof AdvancedAssumptionValues
  label: string
  min: number
  max: number
  suffix?: string
}

const LABELS: Record<keyof AdvancedAssumptionValues, string> = {
  annualRaisePercent: 'Expected annual raise',
  annualReturnPercent: 'Stock return assumption',
  inflationPercent: 'Inflation rate',
  withdrawalRatePercent: 'Withdrawal rate in retirement',
  stocksAllocationPercent: 'Stock allocation (vs. bonds)',
  bondReturnPercent: 'Bond return assumption',
}

const FIELDS: FieldSpec[] = ADVANCED_FIELD_RANGES.map((range) => ({
  key: range.key,
  label: LABELS[range.key],
  min: range.min,
  max: range.max,
  suffix: '%',
}))

interface AdvancedAssumptionsFormProps {
  values: AdvancedAssumptionValues
  onChange: (values: AdvancedAssumptionValues) => void
}

export function AdvancedAssumptionsForm({ values, onChange }: AdvancedAssumptionsFormProps) {
  return (
    // FIN-119: this form now lives on its own Rates sub-tab (rather than being one of several
    // things collapsed under the People tab), so the wrapping `CollapsibleSection` that used to
    // provide its only visible title/toggle ("Advanced assumptions", collapsed by default) is
    // gone — the fields are always visible, directly. The Rates sub-tab's own heading (matching
    // its nav label, same pattern as PeopleTab/AccountsTab) lives in PlanSection.tsx, not here —
    // this component has never owned "Rates" as an identity, only the fields themselves.
    <form aria-label="Advanced assumptions" className={styles.form}>
        {FIELDS.map((field) => (
          <div key={field.key} className={styles.fieldRow}>
            <NumberField
              label={field.label}
              value={values[field.key]}
              min={field.min}
              max={field.max}
              suffix={field.suffix}
              error={rangeError(values[field.key], field.min, field.max)}
              onChange={(value) => onChange({ ...values, [field.key]: value })}
            />
            {field.key === 'withdrawalRatePercent' && (
              <div className={styles.tooltipSlot}>
                <Tooltip label="Why this withdrawal rate?">
                  <p>
                    Longer retirements need a lower withdrawal rate to keep a 90-95% chance of
                    lasting the whole time. We suggest:
                  </p>
                  <ul className={tooltipStyles.rates}>
                    {SAFE_WITHDRAWAL_RATES.map((row) => (
                      <li key={row.years}>
                        <span className={tooltipStyles.rateLabel}>{row.years} years</span>
                        <span className={tooltipStyles.rateValue}>{row.ratePercent}%</span>
                      </li>
                    ))}
                  </ul>
                </Tooltip>
              </div>
            )}
            {(field.key === 'annualReturnPercent' || field.key === 'bondReturnPercent') && (
              // FIN-65 change 3. Everything the app displays is now in today's dollars, so a
              // 7% assumption produces a chart that grows at ~4.4%. Without the real rate
              // stated next to the input, that reads as a bug rather than as the point.
              <span className={styles.realReturnHint}>
                {formatPercent(realReturn(values[field.key] / 100, values.inflationPercent / 100) * 100)}{' '}
                after inflation
              </span>
            )}
            {field.key === 'annualReturnPercent' && (
              <div className={styles.tooltipSlot}>
                <Tooltip label="Suggested stock return assumptions">
                  <p>Some recommended values:</p>
                  <ul className={tooltipStyles.rates}>
                    {SUGGESTED_RETURN_RATES.map((row) => (
                      <li key={row.tier}>
                        <span className={tooltipStyles.rateLabel}>{row.tier}</span>
                        <span className={tooltipStyles.rateValue}>{row.stocksPercent}%</span>
                      </li>
                    ))}
                  </ul>
                </Tooltip>
              </div>
            )}
            {field.key === 'bondReturnPercent' && (
              <div className={styles.tooltipSlot}>
                <Tooltip label="Suggested bond return assumptions">
                  <p>Some recommended values:</p>
                  <ul className={tooltipStyles.rates}>
                    {SUGGESTED_RETURN_RATES.map((row) => (
                      <li key={row.tier}>
                        <span className={tooltipStyles.rateLabel}>{row.tier}</span>
                        <span className={tooltipStyles.rateValue}>{row.bondsPercent}%</span>
                      </li>
                    ))}
                  </ul>
                </Tooltip>
              </div>
            )}
          </div>
        ))}
      </form>
  )
}
