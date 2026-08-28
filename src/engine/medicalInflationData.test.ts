import { describe, expect, it } from 'vitest';

import { HISTORICAL_ANNUAL_INFLATION } from './inflationData';
import { HISTORICAL_ANNUAL_RETURNS } from './historicalReturns';
import { HISTORICAL_ANNUAL_MEDICAL_INFLATION } from './medicalInflationData';

describe('HISTORICAL_ANNUAL_MEDICAL_INFLATION', () => {
  it('covers 1928-2025 inclusive with no gaps or duplicates', () => {
    const years = HISTORICAL_ANNUAL_MEDICAL_INFLATION.map((entry) => entry.year);

    expect(years).toHaveLength(98);
    expect(years[0]).toBe(1928);
    expect(years[years.length - 1]).toBe(2025);
    expect(new Set(years).size).toBe(98);
    years.forEach((year, index) => {
      expect(year).toBe(1928 + index);
    });
  });

  it('covers exactly the years HISTORICAL_ANNUAL_RETURNS (and HISTORICAL_ANNUAL_INFLATION) can draw', () => {
    expect(HISTORICAL_ANNUAL_MEDICAL_INFLATION.map((entry) => entry.year)).toEqual(
      HISTORICAL_ANNUAL_RETURNS.map((entry) => entry.year),
    );
    expect(HISTORICAL_ANNUAL_MEDICAL_INFLATION.map((entry) => entry.year)).toEqual(
      HISTORICAL_ANNUAL_INFLATION.map((entry) => entry.year),
    );
  });

  it('states rates as decimals in a plausible medical-CPI range', () => {
    for (const { year, medicalInflation } of HISTORICAL_ANNUAL_MEDICAL_INFLATION) {
      expect(Number.isFinite(medicalInflation), `${year}`).toBe(true);
      // Realised extremes of the real (1936-2025) series: 1975's post-Medicare-era spike at
      // 12.06%, and the 1932/1933 backfilled Depression-era deflation.
      expect(medicalInflation, `${year}`).toBeGreaterThanOrEqual(-0.17);
      expect(medicalInflation, `${year}`).toBeLessThanOrEqual(0.13);
    }
  });

  /**
   * Spot-checks against the sourced BLS medical-care CPI-U index levels (see the file header):
   * 1975 (the largest real annual increase in the series), 1936 (the first computable real
   * rate — BLS's medical-care CPI-U series has no 1934/1935 rate to compute from, see header),
   * 2020 (COVID-era divergence from the Dec-Dec convention), and 1929 (a backfilled year that's
   * exactly zero, same edge case `inflationData.test.ts` pins for the general series).
   */
  it.each([
    [1929, 0.0],
    [1936, 0.0],
    [1975, 0.1206],
    [2020, 0.0411],
    [2025, 0.0295],
  ])('reports %i medical CPI-U as %f', (year, expected) => {
    expect(
      HISTORICAL_ANNUAL_MEDICAL_INFLATION.find((entry) => entry.year === year)?.medicalInflation,
    ).toBe(expected);
  });

  /**
   * Trap 1 from the header: a single-year spot check against low-precision published index
   * levels is not well conditioned. Trap 2: compounding every rate and checking only the
   * endpoint telescopes to `index[2025]/index[1935]` and is blind to interior corruption. This
   * reconstructs the price level year by year from the real series' 1935 base index (10.200,
   * BLS medical-care CPI-U) and checks it against the sourced index levels at decade
   * checkpoints — an interior check, not an endpoint-only one.
   */
  it.each([
    [1940, 10.350],
    [1950, 15.117],
    [1960, 22.250],
    [1970, 33.950],
    [1980, 74.875],
    [1990, 162.800],
    [2000, 260.750],
    [2010, 388.436],
    [2020, 518.875],
    [2025, 580.498],
  ])('reconstructs the %i medical CPI-U index to %f', (year, published) => {
    const BASE_1935 = 10.2;
    let level = BASE_1935;
    for (const entry of HISTORICAL_ANNUAL_MEDICAL_INFLATION) {
      if (entry.year <= 1935) continue;
      if (entry.year > year) break;
      level *= 1 + entry.medicalInflation;
    }

    expect(Math.abs(level / published - 1), `${year}`).toBeLessThan(0.0005);
  });

  /**
   * The 1928-1935 backfill is `generalInflation[Y] * RATIO`, RATIO = 1.5173 (see file header for
   * how RATIO was computed from the real 1936-2025 overlap). This pins the backfill formula
   * itself, independent of whether the real portion of the table is later revised.
   */
  it.each([1928, 1929, 1930, 1931, 1932, 1933, 1934, 1935])(
    'backfills %i as generalInflation * 1.5173',
    (year) => {
      const general = HISTORICAL_ANNUAL_INFLATION.find((entry) => entry.year === year)?.inflation;
      const medical = HISTORICAL_ANNUAL_MEDICAL_INFLATION.find((entry) => entry.year === year)
        ?.medicalInflation;
      expect(general).toBeDefined();
      expect(medical).toBeDefined();
      expect(medical).toBeCloseTo((general as number) * 1.5173, 3);
    },
  );
});

// `medicalInflationForYear` itself is unit-tested in `monteCarlo.test.ts`, where it lives
// (mirroring `inflationForYear`/`INFLATION_BY_YEAR`'s existing placement in that file).
