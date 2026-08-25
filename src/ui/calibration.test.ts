import { describe, expect, it } from 'vitest'
import { realReturn, runMonteCarloTrials, runProjection, toTodaysDollarRows } from '../engine'
import { DEFAULT_ADVANCED_VALUES, DEFAULT_CORE_VALUES } from './components'
import { SAFE_WITHDRAWAL_RATES } from './components/AdvancedAssumptionsForm/safeWithdrawalRates'
import { PLANNING_HORIZON_END_AGE, toAssumptions } from './hooks/useProjectionState'

/**
 * FIN-64 calibration: the whole point of this ticket was making the app's own Monte Carlo
 * engine agree with Bengen's/the Trinity study's 4%-rule finding — a 30-year retirement at a
 * ~4% withdrawal rate should land a 90-95% success rate. `safeWithdrawalRates.ts` publishes a
 * withdrawal rate per retirement length calibrated to hit that band under this app's *actual*
 * default return/volatility/allocation assumptions.
 *
 * Unlike an earlier version of this suite, every input here is read live from
 * `DEFAULT_CORE_VALUES`, `DEFAULT_ADVANCED_VALUES`, `SAFE_WITHDRAWAL_RATES`, and
 * `PLANNING_HORIZON_END_AGE` — the same constants (via the same `toAssumptions` mapping) the
 * live app builds its Monte Carlo run from — rather than a second, hand-copied set of numbers.
 * That earlier version silently went stale once when the UI defaults were changed without a
 * matching engine-constant change (dropped to 87% success, outside the band, before anyone
 * noticed). Sourcing straight from the real defaults makes that class of drift impossible: if
 * a future change to any default breaks the 90-95% band, this suite fails immediately.
 *
 * IMPORTANT for future changes: if this suite starts failing, the fix is to change the return
 * assumptions, volatility assumptions, allocation, or `safeWithdrawalRates.ts`'s rate for the
 * affected horizon — not to widen the 90-95% band or hardcode a different plan here. The band
 * itself is the product requirement (Bengen/Trinity's historical 4%-rule success rate); a
 * failure here means a real assumption change needs to happen, not a test change.
 *
 * Only `retirementAge` and `withdrawalRatePercent` vary per case (to land on a 30/35/40-year
 * retirement against the fixed 100 planning horizon, and to use that horizon's published safe
 * rate) — every other input (current age, initial balance, income, contribution rate, return
 * assumptions, allocation, inflation) comes straight from the real defaults.
 *
 * A fixed seed makes each run itself deterministic, not flaky in the traditional sense. But a
 * 90-95% band is a tolerance-band assertion, not an exact-value one, and it was chosen (rather
 * than a tighter one) because Monte Carlo sampling variance is real even at a fixed seed and
 * fixed path count — narrower than this would start failing on legitimate small calibration
 * tweaks rather than genuine regressions.
 */
describe('FIN-64 calibration: default assumptions hit the 90-95% safe-withdrawal-rate success band', () => {
  const allocation = {
    stocksPercent: DEFAULT_ADVANCED_VALUES.stocksAllocationPercent,
    bondsPercent: 100 - DEFAULT_ADVANCED_VALUES.stocksAllocationPercent,
  }

  it.each(SAFE_WITHDRAWAL_RATES)(
    'lands a $years-year retirement at $ratePercent% withdrawal (from safeWithdrawalRates.ts) in the 90-95% success band, using the live default assumptions',
    ({ years, ratePercent }) => {
      const plan = toAssumptions(
        { ...DEFAULT_CORE_VALUES, retirementAge: PLANNING_HORIZON_END_AGE - years },
        { ...DEFAULT_ADVANCED_VALUES, withdrawalRatePercent: ratePercent },
      )

      const result = runMonteCarloTrials(plan, allocation, undefined, [], {
        seed: 1,
        simulationCount: 8_000,
      })

      expect(result.successRate).toBeGreaterThanOrEqual(90)
      expect(result.successRate).toBeLessThanOrEqual(95)
    },
  )
})

/**
 * FIN-65: the deterministic Plan tab's counterpart to the suite above.
 *
 * The Monte Carlo suite proves `SAFE_WITHDRAWAL_RATES` lands in Bengen's 90-95% band. That says
 * nothing about the Plan tab, which is a different engine: one compounding line at a fixed rate,
 * no sampling. Both are shown to the user for the same plan, so a rate the stress test calls
 * safe must not produce a Plan chart that visibly drains from the first year of retirement —
 * which is exactly what shipped before this ticket (3.322% real return against a 3.9%
 * withdrawal rate: a guaranteed -0.58pp/yr bleed, presented next to a 90% success badge).
 *
 * The assertion is derived from the model rather than from what the code prints: a portfolio
 * withdrawing a fixed real amount holds its real value iff its real return is at least the
 * withdrawal rate. So the check is `realReturn(annualReturnRate, inflationRate) >= rate`, plus
 * the end-to-end consequence — real terminal balance not below the real balance at retirement.
 *
 * Measured against ProjectionLab (their shipped engine, deterministic mode, research/pl-reference):
 * they apply the user's assumptions raw, giving 4.32% real against a 4.0% withdrawal — a +0.32pp
 * margin, and a plan that grows slightly in today's dollars across a 35-year retirement. We now
 * sit at +0.30pp on the same basis. The prior `expectedPortfolioReturn` call (since deleted)
 * double-counted
 * volatility drag: it converts an arithmetic mean to a geometric one, but the advanced-form
 * return input is already read as a compound rate, and SAFE_WITHDRAWAL_RATES is itself
 * calibrated against realised historical compound returns.
 */
describe('FIN-65: the deterministic Plan tab holds its real value at the published safe withdrawal rates', () => {
  it.each(SAFE_WITHDRAWAL_RATES)(
    'real return covers the $ratePercent% withdrawal for a $years-year retirement',
    ({ years, ratePercent }) => {
      const plan = toAssumptions(
        { ...DEFAULT_CORE_VALUES, retirementAge: PLANNING_HORIZON_END_AGE - years },
        { ...DEFAULT_ADVANCED_VALUES, withdrawalRatePercent: ratePercent },
      )

      expect(realReturn(plan.annualReturnRate, plan.inflationRate)).toBeGreaterThanOrEqual(
        ratePercent / 100,
      )
    },
  )

  it('does not lose real value across retirement at the default assumptions', () => {
    const plan = toAssumptions(DEFAULT_CORE_VALUES, DEFAULT_ADVANCED_VALUES)
    const rows = toTodaysDollarRows(runProjection(plan), plan.inflationRate)

    // `runProjection` emits one row per year from `currentAge`, so the first retirement row is
    // at index (retirementAge - currentAge): its beginning balance is the pot the retiree starts
    // drawing from, in today's dollars.
    const atRetirement = rows[plan.retirementAge - plan.currentAge].beginningBalance
    const atHorizon = rows[rows.length - 1].endingBalance

    expect(atHorizon).toBeGreaterThanOrEqual(atRetirement)
  })
})
