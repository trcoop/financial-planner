/**
 * WP-E: the single shared scenario evaluator (PRD E30, ERD §12.25.1, §12.26). Plans A/B/C and every
 * grid cell go through `evaluateScenario`, so there is exactly one definition of "lifetime total".
 * Calculator totals, growth and crossings start at the asOf month (O17 option b): a collecting
 * person's months earlier in `asOf.year` are not counted.
 */
import { calculatorStartMonth } from '../age';
import { validateGrowthRate } from './growth';
import { computeSocialSecurity } from './household';
import type { AsOf, SsInputs, SsResult } from './types';

/** Household monthly total (own + spousal + survivor, all people) from the asOf month through `lastMonth`. */
export function calculatorHouseholdMonthly(result: SsResult, asOf: AsOf): number[] {
  const from = calculatorStartMonth(asOf) - result.firstMonth;
  const length = result.lastMonth - result.firstMonth + 1 - from;
  const out: number[] = new Array<number>(Math.max(0, length)).fill(0);
  for (const personSeries of result.series) {
    for (let i = 0; i < out.length; i++) {
      const cell = personSeries[from + i];
      out[i] += cell.own + cell.spousal + cell.survivor;
    }
  }
  return out;
}

/**
 * Lifetime total = the final `growthBalance` value of the calculator slice (plain sum when growth is
 * off). Same recursion as `growthBalance`, without allocating the cumulative series.
 */
export function evaluateScenario(inputs: SsInputs): number {
  validateGrowthRate(inputs.growthRate);
  const monthly = calculatorHouseholdMonthly(computeSocialSecurity(inputs), inputs.asOf);
  const g = inputs.growthRate === null ? 1 : (1 + inputs.growthRate) ** (1 / 12);
  let bal = 0;
  for (let i = 0; i < monthly.length; i++) bal = bal * g + monthly[i];
  return bal;
}
