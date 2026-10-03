/** Crossing detection for the calculator chart (PRD E11). Pure. */
import { InvalidProjectionInputError } from '../errors';
import type { MonthIndex } from './types';

/**
 * For each pair (A-B, A-C, B-C) with `d(m) = cumX(m) - cumY(m)`: ties carry the prior sign, and a
 * crossing is recorded only at the first month `d` takes the strictly OPPOSITE sign from the last
 * nonzero sign. Identical prefixes set the initial sign without an event; touch-and-return gives
 * none. `leader` is the plan that just took the lead. Result is ordered by month, then pair order.
 * Ragged lengths and non-finite values throw `NON_FINITE_INPUT` (ERD §12.7 has no better code).
 * `firstMonth` is the calendar month of index 0 (the calculator passes `calculatorStartMonth(asOf)`).
 */
export function findCrossings(
  cumulative: readonly (readonly number[])[],
  firstMonth: MonthIndex,
): { leader: number; trailer: number; month: MonthIndex }[] {
  const len = cumulative.length > 0 ? cumulative[0].length : 0;
  cumulative.forEach((series, p) => {
    if (series.length !== len) {
      throw new InvalidProjectionInputError('NON_FINITE_INPUT', `cumulative[${p}] must have ${len} entries`);
    }
    series.forEach((v, i) => {
      if (!Number.isFinite(v)) {
        throw new InvalidProjectionInputError('NON_FINITE_INPUT', `cumulative[${p}][${i}] must be finite (got ${v})`);
      }
    });
  });
  if (!Number.isFinite(firstMonth)) {
    throw new InvalidProjectionInputError('NON_FINITE_INPUT', `firstMonth must be finite (got ${firstMonth})`);
  }

  const found: { leader: number; trailer: number; month: MonthIndex; pair: number }[] = [];
  let pair = 0;
  for (let x = 0; x < cumulative.length; x++) {
    for (let y = x + 1; y < cumulative.length; y++, pair++) {
      let lastSign = 0;
      for (let i = 0; i < len; i++) {
        const d = cumulative[x][i] - cumulative[y][i];
        const sign = d > 0 ? 1 : d < 0 ? -1 : 0;
        if (sign === 0) continue;
        if (lastSign !== 0 && sign !== lastSign) {
          found.push({ leader: sign > 0 ? x : y, trailer: sign > 0 ? y : x, month: firstMonth + i, pair });
        }
        lastSign = sign;
      }
    }
  }
  found.sort((a, b) => a.month - b.month || a.pair - b.pair);
  return found.map(({ leader, trailer, month }) => ({ leader, trailer, month }));
}
