/**
 * Reference table (FIN-64) for the "why this withdrawal rate?" info dialog: the withdrawal
 * rate that lands this app's own Monte Carlo engine — {@link DEFAULT_RETURN_ASSUMPTIONS},
 * {@link DEFAULT_VOLATILITY_ASSUMPTIONS}, the 70/30 default allocation — at a 90-95% success
 * rate for a retirement of that length. Verified directly against `runMonteCarloTrials`, not
 * copied from Bengen's original published figures: those were fit to different return/
 * volatility assumptions and don't reproduce a 90-95% success rate under this engine's
 * calibration. See `monteCarlo.test.ts`'s "FIN-64 calibration" suite for the regression tests
 * that keep this table honest as the engine's own defaults evolve.
 */
export interface SafeWithdrawalRateRow {
  years: number
  ratePercent: number
}

export const SAFE_WITHDRAWAL_RATES: SafeWithdrawalRateRow[] = [
  { years: 30, ratePercent: 4.0 },
  { years: 35, ratePercent: 3.9 },
  { years: 40, ratePercent: 3.7 },
]
