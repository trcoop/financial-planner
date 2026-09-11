/**
 * §5.5 indexing resolution for the federal tax engine.
 *
 * Resolves a published-actuals ladder/amount plus an `IndexingPolicy` into a concrete number (or
 * `Ladder`) for a target year. Imports `types.ts` only — never `tables.ts` (WP-C, not yet built).
 */

import type { IndexedAmount, IndexedLadder, IndexingRates, Ladder, LadderBand } from './types';
import { roundToNearest, truncateTo } from './rounding';

function lastPublishedYear(published: Readonly<Record<number, unknown>>): number {
  return Math.max(...Object.keys(published).map(Number));
}

/**
 * Resolve one indexed dollar amount for `year`.
 *
 * If `year` is a published actual, it is returned exactly, no computation, regardless of policy
 * kind. Otherwise the value compounds forward from the LAST published actual.
 *
 * The compounding exponent is always `year - lastPublishedYear`. The statutory lags embedded in
 * `IndexingPolicy` (chained CPI-U's ~16-month lag, AWI's 2-year lag via `lagYears`) do NOT change
 * this exponent — the lag is already baked into the published actual being compounded off.
 * `lagYears` is documentation of statutory provenance only; it is never read here.
 */
export function resolveIndexedAmount(
  entry: IndexedAmount,
  year: number,
  indexing: IndexingRates,
): number {
  const published = entry.published[year];
  if (published !== undefined) return published;

  const last = lastPublishedYear(entry.published);
  const base = entry.published[last];
  const n = year - last;

  switch (entry.policy.kind) {
    case 'frozen':
    case 'statutory-rate':
    case 'sunset':
      return base;
    case 'chained-cpi-u': {
      const raw = base * (1 + indexing.chainedCpiU) ** n;
      return truncateTo(raw, entry.policy.rounding.increment);
    }
    case 'average-wage-index': {
      const raw = base * (1 + indexing.averageWageIndex) ** n;
      return roundToNearest(raw, 300);
    }
  }
}

/**
 * Resolve an indexed ladder for `year`: the same per-bound resolution logic applied to every
 * bound of the ladder published for the last published year. `Infinity` and `0` bounds pass
 * through unchanged (there is nothing to compound). Only bounds are indexed — a band's `rate` is
 * never touched.
 */
export function resolveIndexedLadder(
  entry: IndexedLadder,
  year: number,
  indexing: IndexingRates,
): Ladder {
  const publishedForYear = entry.published[year];
  if (publishedForYear !== undefined) return publishedForYear;

  const last = lastPublishedYear(entry.published);
  const baseLadder = entry.published[last];
  const n = year - last;

  const resolveBound = (bound: number): number => {
    if (bound === Infinity || bound === 0) return bound;
    switch (entry.policy.kind) {
      case 'frozen':
      case 'statutory-rate':
      case 'sunset':
        return bound;
      case 'chained-cpi-u': {
        const raw = bound * (1 + indexing.chainedCpiU) ** n;
        return truncateTo(raw, entry.policy.rounding.increment);
      }
      case 'average-wage-index': {
        const raw = bound * (1 + indexing.averageWageIndex) ** n;
        return roundToNearest(raw, 300);
      }
    }
  };

  return baseLadder.map(
    (band): LadderBand => ({
      rate: band.rate,
      lowerBound: resolveBound(band.lowerBound),
      upperBound: resolveBound(band.upperBound),
    }),
  );
}
