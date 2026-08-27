import { describe, expect, it } from 'vitest';

import { HISTORICAL_ANNUAL_RETURNS } from './historicalReturns';
import { HISTORICAL_ANNUAL_INFLATION } from './inflationData';

/**
 * FIN-65 change 1 relies on being able to look up *every* year the return table can draw.
 * A gap would silently fall back to `assumptions.inflationRate` for that year, reintroducing
 * exactly the mixed nominal/real defect the change exists to remove — so the year ranges are
 * pinned against each other rather than each being checked alone.
 */
describe('HISTORICAL_ANNUAL_INFLATION', () => {
  it('covers 1928-2025 inclusive with no gaps or duplicates', () => {
    const years = HISTORICAL_ANNUAL_INFLATION.map((entry) => entry.year);

    expect(years).toHaveLength(98);
    expect(years[0]).toBe(1928);
    expect(years[years.length - 1]).toBe(2025);
    expect(new Set(years).size).toBe(98);
    years.forEach((year, index) => {
      expect(year).toBe(1928 + index);
    });
  });

  it('covers exactly the years HISTORICAL_ANNUAL_RETURNS can draw', () => {
    expect(HISTORICAL_ANNUAL_INFLATION.map((entry) => entry.year)).toEqual(
      HISTORICAL_ANNUAL_RETURNS.map((entry) => entry.year),
    );
  });

  it('states rates as decimals in a plausible CPI-U range', () => {
    for (const { year, inflation } of HISTORICAL_ANNUAL_INFLATION) {
      expect(Number.isFinite(inflation), `${year}`).toBe(true);
      // The realised extremes of the series: 1932 at -10.53% and 1946-47's post-war spike.
      expect(inflation, `${year}`).toBeGreaterThanOrEqual(-0.11);
      expect(inflation, `${year}`).toBeLessThanOrEqual(0.2);
    }
  });

  /**
   * Spot-checks against the published Minneapolis Fed CPI-U table, including the years the
   * FIN-65 investigation turns on: 1966 (the canonical worst SWR cohort's first year) and
   * 1929 (exactly zero, which is why the lookup uses `??` and not `||`).
   */
  it.each([
    [1929, 0.0],
    [1932, -0.1053],
    [1966, 0.0317],
    [1979, 0.1135],
    [2021, 0.0471],
  ])('reports %i CPI-U as %f', (year, expected) => {
    expect(HISTORICAL_ANNUAL_INFLATION.find((entry) => entry.year === year)?.inflation).toBe(expected);
  });

  /**
   * The spot-checks above pin five individual cells, but a wholesale rescale of the series
   * would pass every one of them. A round-2 FIN-65 review also showed that compounding all 98
   * rates and checking the endpoint proves less than it looks: because each rate is
   * `index[Y]/index[Y-1] - 1`, the product telescopes exactly to `index[2025]/index[1927]`,
   * so it validates the two endpoints and is structurally blind to every value in between —
   * any pair of offsetting per-year errors passes unchanged.
   *
   * This reconstructs the price level year by year from a 1927 base of 17.4 and checks it
   * against published BLS CPI-U annual averages at decade checkpoints. That IS an interior
   * check: a corrupted year throws off every checkpoint after it.
   */
  it.each([
    [1940, 14.0],
    [1950, 24.1],
    [1960, 29.6],
    [1970, 38.8],
    [1980, 82.4],
    [1990, 130.7],
    [2000, 172.2],
    [2010, 218.056],
    [2020, 258.811],
    [2024, 313.689],
    // The final cell of the table: pinned by nothing else (the Bengen cohorts stop at 2023), and
    // the row most likely to be mistyped or revised on a data refresh. Verified against MIT IR's
    // published CPI-U calendar-year series (2025 = 321.9, 2.63%; 2024 = 313.7; 2023 = 304.7).
    [2025, 321.9],
  ])('reconstructs the %i price level to the published CPI-U index of %f', (year, published) => {
    const BASE_1927 = 17.4;
    let level = BASE_1927;
    for (const entry of HISTORICAL_ANNUAL_INFLATION) {
      if (entry.year > year) break;
      level *= 1 + entry.inflation;
    }

    // Measured drift across all ten checkpoints is <= 0.03%; 0.05% leaves headroom for the
    // published table's own rounding without admitting a real data error.
    expect(Math.abs(level / published - 1), `${year}`).toBeLessThan(0.0005);
  });

});
