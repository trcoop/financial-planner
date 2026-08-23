/**
 * Reference table (FIN-64) for the "suggested return assumptions" info dialogs on the stock and
 * bond return fields. Three tiers:
 *
 * - Aggressive: the raw historical average, {@link DEFAULT_RETURN_ASSUMPTIONS} in
 *   `src/engine/monteCarlo.ts` (11.5% stocks / 5% bonds) — the same 1928-2025 dataset
 *   (`historicalReturns.ts`) that drives the Monte Carlo engine's own block-bootstrap, so this
 *   isn't a separate guess, just that average surfaced for the Tier 1 projection field too.
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
