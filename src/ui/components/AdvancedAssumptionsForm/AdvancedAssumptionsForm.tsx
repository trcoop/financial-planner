import { realReturn } from '../../../engine'
import { formatPercent } from '../../utils/format'
import { CollapsibleSection } from '../CollapsibleSection/CollapsibleSection'
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

/** Advanced-assumption defaults per FIN-10's spec. Planning horizon is a call-site default
 * per FIN-19 — not user input for the MVP. */
/**
 * FIN-64: stocks 8%/bonds 4% (Tier 1 only, blended via `blendedPortfolioReturn` at the 70/30
 * default allocation) and a 3.9% withdrawal rate. FIN-65: no volatility-drag adjustment is
 * applied on top — these are already compound rates, so 70/30 gives 6.8% nominal / 4.195% real
 * against 2.5% inflation, comfortably above the 3.9% withdrawal. `calibration.test.ts` pins
 * that margin; without it the Plan chart drained from the first year of retirement.
 *
 * The two tiers deliberately use different return bases now. Tier 1's raw historical average
 * (~11.5%/5%, matching `DEFAULT_RETURN_ASSUMPTIONS` in `src/engine/monteCarlo.ts`) compounded a
 * single deterministic line out to implausible decades-out balances — a real property of
 * compounding a long-run historical average for 60+ years, not a bug, but not what a
 * forward-looking "here's roughly what to expect" line should show either. 8% stocks sits
 * between that raw historical average and a more conservative forward estimate (J.P. Morgan's
 * 2026 Long-Term Capital Market Assumptions puts a 60/40 portfolio at 6.4% nominal, 10-15yr
 * horizon) — chosen deliberately over the more conservative figure for this single line.
 *
 * Tier 2 (the Monte Carlo stress test) is unaffected by this field: its default
 * `returnModel: 'historical'` block-bootstraps real 1928-2025 annual returns directly (see that
 * constant's doc comment in `src/engine/monteCarlo.ts`), which is what actually keeps the
 * withdrawal rate in the 90-95% Trinity/Bengen band — this field does not touch that
 * calibration, confirmed by `src/ui/calibration.test.ts`'s FIN-64 suite staying green
 * independent of this value. See `safeWithdrawalRates.ts` for the withdrawal rate (3.9% is what
 * a 35-year retirement — the 65 retirement age default paired with the fixed 100 planning
 * horizon — needs for a 90-95% Monte Carlo success rate).
 */
export const DEFAULT_ADVANCED_VALUES: AdvancedAssumptionValues = {
  annualRaisePercent: 3,
  annualReturnPercent: 8,
  inflationPercent: 2.5,
  withdrawalRatePercent: 3.9,
  stocksAllocationPercent: 70,
  bondReturnPercent: 4,
}

export function AdvancedAssumptionsForm({ values, onChange }: AdvancedAssumptionsFormProps) {
  return (
    <CollapsibleSection summary="Advanced assumptions">
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
    </CollapsibleSection>
  )
}
