/**
 * Progressive bracket math (ERD §5.4). Pure, value-indifferent: takes a `Ladder` as a parameter
 * and has no opinion about where it comes from (`tables.ts` is WP-B2's job, not this module's).
 */

import type { BracketOccupancy, Ladder } from './types';

/**
 * Occupies every band of `ladder` against `income`, after shifting bounds by `shift` (ERD §5.3
 * step 4). Returns every band, including unoccupied ones, in ladder order.
 *
 * The lowest band's floor is pinned to `0` STRUCTURALLY (`index === 0 ? 0 : …`), never derived
 * via the `max(0, …)` clamp — that clamp applies only to every other band's bounds. Getting this
 * backwards is the exact regression the ERD's round-1 review caught: with a negative `shift`,
 * `max(0, band.lowerBound - shift)` on band 0 produces a positive floor and silently drops income
 * from the bottom of the ladder.
 */
export function occupyLadder(ladder: Ladder, income: number, shift = 0): BracketOccupancy[] {
  return ladder.map((band, index) => {
    const lowerBound = index === 0 ? 0 : Math.max(0, band.lowerBound - shift);
    const upperBound =
      band.upperBound === Infinity ? Infinity : Math.max(0, band.upperBound - shift);
    const incomeInThisBracket = Math.max(0, Math.min(income, upperBound) - lowerBound);
    const taxFromThisBracket = incomeInThisBracket * band.rate;

    return {
      rate: band.rate,
      lowerBound,
      upperBound,
      incomeInThisBracket,
      taxFromThisBracket,
    };
  });
}

/**
 * The statutory rate of the unique band with `lowerBound <= amount < upperBound`.
 *
 * This is a DIFFERENT question from `occupyLadder`'s partition of `[0, income)`: occupancy asks
 * which band a dollar BELOW `income` falls into (so `income` exactly at a boundary lands in the
 * LOWER band), while this asks which band `amount` itself falls into AT the point (so `amount`
 * exactly at a boundary lands in the UPPER band). Both are correct per the same half-open
 * `[lower, upper)` convention (ERD §5.4) — they are not meant to agree.
 */
export function bandRateAt(ladder: Ladder, amount: number): number {
  const band = ladder.find((b) => b.lowerBound <= amount && amount < b.upperBound);

  if (band === undefined) {
    throw new Error(`bandRateAt: no band in ladder contains amount ${amount}`);
  }

  return band.rate;
}

/**
 * Sum of `occupyLadder(...).map(b => b.taxFromThisBracket)` — UNROUNDED. Rounding/allocation is
 * the orchestrator's job (WP-B2), not this module's.
 */
export function ladderTax(ladder: Ladder, income: number, shift = 0): number {
  return occupyLadder(ladder, income, shift).reduce((sum, b) => sum + b.taxFromThisBracket, 0);
}
