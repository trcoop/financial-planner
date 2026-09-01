import type { AdvancedAssumptionValues } from './AdvancedAssumptionsForm'

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
