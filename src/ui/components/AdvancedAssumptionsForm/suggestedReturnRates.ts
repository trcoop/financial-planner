/**
 * Reference table (FIN-64) for the "suggested return assumptions" info dialogs on the stock and
 * bond return fields. Three tiers:
 *
 * - Aggressive: {@link DEFAULT_RETURN_ASSUMPTIONS} in `src/engine/monteCarlo.ts` (11.5% stocks /
 *   5% bonds) — the same figures the Monte Carlo engine falls back to for its parametric 'gbm'
 *   return model, sourced from Ibbotson SBBI/Damodaran (see that constant's own doc comment).
 *   Close to but not identical to the mean of the bundled 1928-2025 dataset
 *   (`historicalReturns.ts`, ~11.9% stocks / ~4.8% bonds) that actually drives the engine's
 *   production block-bootstrap — reusing the already-cited `DEFAULT_RETURN_ASSUMPTIONS` value
 *   here rather than a separately-computed dataset average, so there's one number to keep in
 *   sync instead of two.
 * - Moderate: this app's own defaults ({@link DEFAULT_ADVANCED_VALUES}, 8% stocks / 4% bonds) —
 *   see that constant's doc comment for why 8% was chosen over the raw historical average.
 * - Conservative: a deliberately more cautious rule-of-thumb pair (5% stocks / 2.5% bonds),
 *   below most published forward-looking capital-market estimates (e.g. J.P. Morgan's 2026
 *   LTCMA), for planning that wants real margin against a below-average-return future rather
 *   than a single "best guess" line.
 */
export interface SuggestedReturnRateRow {
  tier: string
  stocksPercent: number
  bondsPercent: number
}

export const SUGGESTED_RETURN_RATES: SuggestedReturnRateRow[] = [
  { tier: 'Aggressive growth', stocksPercent: 11.5, bondsPercent: 5 },
  { tier: 'Moderate (our default)', stocksPercent: 8, bondsPercent: 4 },
  { tier: 'Conservative', stocksPercent: 5, bondsPercent: 2.5 },
]
