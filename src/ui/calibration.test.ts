import { describe, expect, it } from 'vitest'
import { runMonteCarloTrials } from '../engine'
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
