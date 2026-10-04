/**
 * Pure ranking + greedy spacing filter for `topClaims` (ERD §12.25.2, §12.24). Kept separate from the
 * evaluator so the rule is unit-testable with synthetic totals.
 */
import type { TopClaim } from './types';

const sum = (c: TopClaim): number => c.claimMonths.reduce<number>((s, m) => s + (m ?? 0), 0);

/**
 * Ranks by `Math.round(total * 100)` descending (transitive cent key), ties to the smaller sum of claim
 * months, then the smaller person-0 month. Walks the ranking and accepts a candidate iff, for EVERY
 * accepted item, at least one varying person's claim month differs by >= 12. Stops at `n`; never pads.
 */
export function selectTopClaims(candidates: readonly TopClaim[], varying: readonly number[], n: number): TopClaim[] {
  const keyed = candidates.map((c) => ({ c, key: Math.round(c.total * 100), sum: sum(c) }));
  keyed.sort(
    (a, b) => b.key - a.key || a.sum - b.sum || (a.c.claimMonths[0] ?? 0) - (b.c.claimMonths[0] ?? 0),
  );
  const accepted: TopClaim[] = [];
  for (const { c } of keyed) {
    if (accepted.length >= n) break;
    const spaced = accepted.every((a) =>
      varying.some((p) => Math.abs((c.claimMonths[p] as number) - (a.claimMonths[p] as number)) >= 12),
    );
    if (spaced) accepted.push(c);
  }
  return accepted;
}
