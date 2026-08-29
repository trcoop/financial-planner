/**
 * Shared deflation core (FIN-67), consolidating two implementations that computed the same
 * concept two different ways:
 *
 * - `projection.ts`'s `toTodaysDollarRows` (deterministic): a single fixed inflation rate every
 *   period, deflating full `ProjectionRow`s.
 * - `monteCarlo.ts`'s `toTodaysDollars` (Monte Carlo): a per-path cumulative CPI index built
 *   from that path's own drawn historical years, deflating bare balances.
 *
 * Both are "divide this period's value by the price level at the end of that period" — they
 * only differed in how the price level was built (a fixed rate compounded vs. a per-path
 * historical walk) and what shape of value got divided (a full row vs. a number). This module
 * factors out both: {@link computeCumulativeInflationIndex} builds a price-level series from
 * any per-period inflation sequence (a real caller varies it; the deterministic caller just
 * passes the same rate every period), and {@link deflateSeries} divides any per-period value by
 * that series via a caller-supplied divide function, so it covers both the "one number per
 * period" and "one row per period" call shapes without assuming either.
 */

/**
 * Compounds a per-period inflation-rate (or realised-inflation) sequence into a cumulative
 * end-of-period price level series, today = 1 before period 0.
 *
 * `result[i]` is the price level after `i + 1` periods of compounding — the level a value
 * earned or spent DURING period `i` should be deflated by, since it is measured at the end of
 * that period. A constant rate every period reproduces `(1 + rate) ** (year + 1)`, which is
 * exactly what the deterministic side computed directly before FIN-67; a varying rate (Monte
 * Carlo's realised historical inflation per period) reproduces that path's own CPI walk.
 */
export const computeCumulativeInflationIndex = (inflationRates: readonly number[]): number[] => {
  let priceLevel = 1;

  return inflationRates.map((rate) => {
    priceLevel *= 1 + rate;
    return priceLevel;
  });
};

/**
 * Divides each per-period value by that period's price level, via a caller-supplied `divide`
 * so this works whether a "value" is a bare number (Monte Carlo's balances) or a structured row
 * with several fields that must all be divided by the same price level (the deterministic
 * projection's rows) — see this module's doc comment.
 */
export const deflateSeries = <T>(
  values: readonly T[],
  priceLevels: readonly number[],
  divide: (value: T, priceLevel: number) => T,
): T[] => values.map((value, index) => divide(value, priceLevels[index]));
