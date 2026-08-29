/**
 * FIN-67: shared deflation core, consolidating what were two hand-maintained implementations
 * of the same concept — `projection.ts`'s `toTodaysDollarRows` (fixed inflation rate, full
 * rows) and `monteCarlo.ts`'s `toTodaysDollars` (per-path cumulative CPI index, bare balances).
 * Both divide a per-year value by that year's price level; they differed only in how the price
 * level was built and what shape of value they divided.
 *
 * This file merges the two functions' prior test suites (from `projection.test.ts`'s
 * `toTodaysDollarRows` describe block and `monteCarlo.test.ts`'s "FIN-65: toTodaysDollars..."
 * describe block) alongside new tests for the shared primitives, per FIN-67 constraint #5:
 * every input/output pair tested before must still be tested and must still expect the exact
 * same output.
 */
import { describe, expect, it } from 'vitest';

import { computeCumulativeInflationIndex, deflateSeries } from './deflate';
import { runProjection, toTodaysDollarRows } from './projection';
import { toTodaysDollars } from './monteCarlo';
import type { PlanAssumptions } from './types';

describe('computeCumulativeInflationIndex', () => {
  it('compounds a per-period rate into a cumulative end-of-period price level', () => {
    const result = computeCumulativeInflationIndex([0.1, 0.1]);

    expect(result[0]).toBeCloseTo(1.1, 12);
    expect(result[1]).toBeCloseTo(1.21, 12);
  });

  it('matches (1 + rate) ** (year + 1) when the rate is constant every period', () => {
    const years = 5;
    const rate = 0.03;

    const index = computeCumulativeInflationIndex(Array(years).fill(rate));

    index.forEach((priceLevel, year) => {
      expect(priceLevel).toBeCloseTo((1 + rate) ** (year + 1), 12);
    });
  });

  it('returns an empty index for an empty input', () => {
    expect(computeCumulativeInflationIndex([])).toEqual([]);
  });
});

describe('deflateSeries', () => {
  it('divides each value by the price level at the same index', () => {
    const result = deflateSeries([100, 100], [1.1, 1.21], (value, priceLevel) => value / priceLevel);

    expect(result[0]).toBeCloseTo(90.909090909, 6);
    expect(result[1]).toBeCloseTo(82.644628099, 6);
  });

  it('applies the caller-supplied divide function rather than assuming a shape', () => {
    const rows = [{ amount: 200 }, { amount: 200 }];

    const result = deflateSeries(rows, [2, 4], (row, priceLevel) => ({ amount: row.amount / priceLevel }));

    expect(result).toEqual([{ amount: 100 }, { amount: 50 }]);
  });
});

const assumptions = (overrides: Partial<PlanAssumptions> = {}): PlanAssumptions => ({
  currentAge: 35,
  retirementAge: 67,
  initialBalance: 100_000,
  currentAnnualIncome: 80_000,
  annualContributionRate: 0.15,
  annualRaiseRate: 0.03,
  annualReturnRate: 0.07,
  inflationRate: 0.025,
  withdrawalRateInRetirement: 0.04,
  planningHorizonEndAge: 100,
  ...overrides,
});

/**
 * Merged from `projection.test.ts`'s former `toTodaysDollarRows` describe block (FIN-65
 * change 3). The Plan tab has to speak the same units as the Stress Test tab, or the two tabs
 * report different numbers for the same plan and the app looks broken.
 */
describe('toTodaysDollarRows', () => {
  const plan = assumptions({
    currentAge: 40,
    retirementAge: 43,
    planningHorizonEndAge: 45,
    initialBalance: 100_000,
    inflationRate: 0.03,
  });

  it('divides each year by the price level that year, compounded from today', () => {
    const nominal = runProjection(plan);
    const real = toTodaysDollarRows(nominal, 0.03);

    real.forEach((row, i) => {
      expect(row.endingBalance).toBeCloseTo(nominal[i].endingBalance / 1.03 ** (i + 1), 6);
    });
  });

  it('keeps each row internally consistent, so the detail breakdown still adds up', () => {
    const real = toTodaysDollarRows(runProjection(plan), 0.03);

    for (const row of real) {
      expect(
        row.beginningBalance - row.annualWithdrawal + row.investmentReturn + row.annualContribution,
      ).toBeCloseTo(row.endingBalance, 6);
    }
  });

  it('leaves age and year untouched', () => {
    const nominal = runProjection(plan);
    const real = toTodaysDollarRows(nominal, 0.03);

    expect(real.map((row) => [row.age, row.year])).toEqual(nominal.map((row) => [row.age, row.year]));
  });

  it('is the identity at zero inflation', () => {
    const nominal = runProjection(plan);

    expect(toTodaysDollarRows(nominal, 0)).toEqual(nominal);
  });

  it('flattens an inflation-indexed withdrawal to a constant in real terms', () => {
    const real = toTodaysDollarRows(runProjection(plan), 0.03);
    const retired = real.filter((row) => row.annualWithdrawal > 0);

    expect(retired.length).toBeGreaterThan(1);
    for (const row of retired) {
      expect(row.annualWithdrawal).toBeCloseTo(retired[0].annualWithdrawal, 6);
    }
  });
});

/**
 * Merged from `monteCarlo.test.ts`'s "FIN-65: toTodaysDollars deflates each year by that year
 * price level" describe block. Round 2 of the FIN-65 review found the deflator itself
 * undefended: changing `toTodaysDollars` to divide every year by `inflationIndex[0]` instead of
 * `inflationIndex[year]` passed the entire suite at the time, because the existing coverage used
 * single-period paths, where those two indices are the same value by construction.
 */
describe('toTodaysDollars', () => {
  it('uses a per-year index, not the first year for the whole path', () => {
    const path = { balances: [100, 100], inflationIndex: [1.1, 1.21], ruinPeriod: null };

    const real = toTodaysDollars(path);

    expect(real[0]).toBeCloseTo(90.909090909, 6);
    expect(real[1]).toBeCloseTo(82.644628099, 6);
    expect(real[1]).not.toBeCloseTo(real[0], 6);
  });

  it('keeps falling in real terms across a long path even when nominal is flat', () => {
    const years = 40;
    const index = Array.from({ length: years }, (_unused, i) => 1.03 ** (i + 1));
    const path = { balances: Array(years).fill(1_000_000), inflationIndex: index, ruinPeriod: null };

    const real = toTodaysDollars(path);

    expect(real[years - 1]).toBeCloseTo(1_000_000 / 1.03 ** years, 6);
    expect(real[years - 1]).toBeLessThan(real[0] / 3);
  });
});
