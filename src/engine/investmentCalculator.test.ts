import { describe, expect, it } from 'vitest';

import {
  InvalidInvestmentInputError,
  runInvestmentProjection,
} from './investmentCalculator';
import type { InvestmentCalculatorErrorCode, InvestmentProjectionInput } from './investmentCalculator';

/** Default happy-path input, overridable per scenario. */
const input = (overrides: Partial<InvestmentProjectionInput> = {}): InvestmentProjectionInput => ({
  startingAmount: 10_000,
  annualGrowthRate: 5,
  compoundingFrequency: 'annually',
  contributionAmount: 0,
  contributionFrequency: 'annually',
  contributionTiming: 'end',
  years: 3,
  ...overrides,
});

/** Asserts `runInvestmentProjection` throws `InvalidInvestmentInputError` carrying `code`. */
const expectRejection = (
  bad: InvestmentProjectionInput,
  code: InvestmentCalculatorErrorCode,
): void => {
  let thrown: unknown;
  try {
    runInvestmentProjection(bad);
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(InvalidInvestmentInputError);
  expect((thrown as InvalidInvestmentInputError).code).toBe(code);
  expect((thrown as InvalidInvestmentInputError).message).toBeTruthy();
};

describe('runInvestmentProjection — starting amount only', () => {
  it('compounds annually with no contributions', () => {
    const result = runInvestmentProjection(
      input({ startingAmount: 10_000, annualGrowthRate: 5, contributionAmount: 0, years: 3 }),
    );

    // Hand-computed: 10000 * 1.05^3 = 11576.25
    expect(result.finalBalance).toBeCloseTo(11576.25, 6);
    expect(result.totalContributions).toBe(0);
    expect(result.totalGrowth).toBeCloseTo(1576.25, 6);
    expect(result.rows).toHaveLength(4); // year 0..3
    expect(result.rows[0]).toEqual({ year: 0, balance: 10_000 });
  });
});

describe('runInvestmentProjection — starting amount + contributions', () => {
  it('applies annual end-of-period contributions after that period growth', () => {
    const result = runInvestmentProjection(
      input({
        startingAmount: 1_000,
        annualGrowthRate: 10,
        contributionAmount: 100,
        contributionFrequency: 'annually',
        contributionTiming: 'end',
        years: 2,
      }),
    );

    // year1: 1000*1.1=1100, +100=1200; year2: 1200*1.1=1320, +100=1420
    expect(result.finalBalance).toBeCloseTo(1420, 6);
    expect(result.totalContributions).toBeCloseTo(200, 6);
    expect(result.totalGrowth).toBeCloseTo(220, 6);
  });
});

describe('runInvestmentProjection — multi-year visible compounding', () => {
  it('matches the closed-form compound interest formula over multiple years', () => {
    const startingAmount = 2_000;
    const annualGrowthRate = 6;
    const years = 5;
    const result = runInvestmentProjection(
      input({ startingAmount, annualGrowthRate, contributionAmount: 0, years }),
    );

    const expected = startingAmount * Math.pow(1 + annualGrowthRate / 100, years);
    expect(result.finalBalance).toBeCloseTo(expected, 6);
  });
});

describe('runInvestmentProjection — non-default compounding frequency', () => {
  it('matches a hand-computed value for quarterly compounding', () => {
    const startingAmount = 5_000;
    const annualGrowthRate = 8;
    const years = 2;
    const result = runInvestmentProjection(
      input({
        startingAmount,
        annualGrowthRate,
        compoundingFrequency: 'quarterly',
        contributionAmount: 0,
        years,
      }),
    );

    // 5000 * (1 + 0.08/4)^(4*2) = 5000 * 1.02^8
    const expected = startingAmount * Math.pow(1 + annualGrowthRate / 100 / 4, 4 * years);
    expect(result.finalBalance).toBeCloseTo(expected, 6);
  });

  it('matches a hand-computed value for monthly compounding', () => {
    const startingAmount = 1_000;
    const annualGrowthRate = 12;
    const years = 1;
    const result = runInvestmentProjection(
      input({
        startingAmount,
        annualGrowthRate,
        compoundingFrequency: 'monthly',
        contributionAmount: 0,
        years,
      }),
    );

    const expected = startingAmount * Math.pow(1 + annualGrowthRate / 100 / 12, 12 * years);
    expect(result.finalBalance).toBeCloseTo(expected, 6);
  });
});

describe('runInvestmentProjection — contribution timing', () => {
  it('start-of-period contributions earn growth in the same period; end-of-period contributions do not', () => {
    const base = input({
      startingAmount: 0,
      annualGrowthRate: 12,
      contributionAmount: 1_000,
      contributionFrequency: 'annually',
      compoundingFrequency: 'annually',
      years: 1,
    });

    const start = runInvestmentProjection({ ...base, contributionTiming: 'start' });
    const end = runInvestmentProjection({ ...base, contributionTiming: 'end' });

    expect(start.finalBalance).toBeCloseTo(1_120, 6);
    expect(end.finalBalance).toBeCloseTo(1_000, 6);
    expect(start.finalBalance).toBeGreaterThan(end.finalBalance);
  });
});

describe('runInvestmentProjection — contribution bucketing at a non-evenly-divisible boundary', () => {
  it('matches an independently-computed reference for daily compounding + monthly contributions', () => {
    // 365 is not evenly divisible by 12, so the compounding-period each monthly
    // contribution lands in (per the ERD §2 bucketing rule) is not a round number
    // of days apart. This independently re-derives the expected balance from the
    // documented rule (contribution c, 0-indexed, due at fraction (c+1)/12 of the
    // year for 'end' timing, landing in daily period ceil(fraction*365)-1) so the
    // test fails if the implementation's bucket-boundary math (e.g. ceil vs floor)
    // regresses, independent of the implementation's own source.
    const startingAmount = 3_000;
    const annualGrowthRate = 9;
    const contributionAmount = 150;
    const years = 2;
    const periodsPerYear = 365;
    const contributionPeriodsPerYear = 12;
    const periodRate = annualGrowthRate / 100 / periodsPerYear;

    const contributionsPerPeriod = new Array(periodsPerYear).fill(0);
    for (let c = 0; c < contributionPeriodsPerYear; c += 1) {
      const periodIndex = Math.max(
        0,
        Math.ceil(((c + 1) * periodsPerYear) / contributionPeriodsPerYear) - 1,
      );
      contributionsPerPeriod[periodIndex] += 1;
    }

    let expectedBalance = startingAmount;
    for (let year = 0; year < years; year += 1) {
      for (let i = 0; i < periodsPerYear; i += 1) {
        expectedBalance *= 1 + periodRate;
        expectedBalance += contributionsPerPeriod[i] * contributionAmount;
      }
    }

    const result = runInvestmentProjection(
      input({
        startingAmount,
        annualGrowthRate,
        compoundingFrequency: 'daily',
        contributionAmount,
        contributionFrequency: 'monthly',
        contributionTiming: 'end',
        years,
      }),
    );

    expect(result.finalBalance).toBeCloseTo(expectedBalance, 6);
  });
});

describe('runInvestmentProjection — sum identity', () => {
  it('totalContributions + totalGrowth + startingAmount equals finalBalance within 1e-6 relative tolerance', () => {
    const result = runInvestmentProjection(
      input({
        startingAmount: 15_000,
        annualGrowthRate: 7,
        compoundingFrequency: 'daily',
        contributionAmount: 250,
        contributionFrequency: 'monthly',
        contributionTiming: 'start',
        years: 30,
      }),
    );

    const sum = result.totalContributions + result.totalGrowth + 15_000;
    const relativeError = Math.abs(sum - result.finalBalance) / Math.abs(result.finalBalance);
    expect(relativeError).toBeLessThan(1e-6);
  });
});

describe('runInvestmentProjection — rows', () => {
  it('returns one row per year (+1 for year 0) regardless of sub-annual granularity', () => {
    const result = runInvestmentProjection(
      input({ compoundingFrequency: 'daily', years: 4 }),
    );
    expect(result.rows).toHaveLength(5);
    expect(result.rows.map((r) => r.year)).toEqual([0, 1, 2, 3, 4]);
    expect(result.rows[result.rows.length - 1].balance).toBeCloseTo(result.finalBalance, 6);
  });
});

describe('runInvestmentProjection — invalid input', () => {
  it('rejects a negative starting amount', () => {
    expectRejection(input({ startingAmount: -1 }), 'INVESTMENT_NEGATIVE_STARTING_AMOUNT');
  });

  it('rejects a starting amount above the max bound', () => {
    expectRejection(input({ startingAmount: 100_000_001 }), 'INVESTMENT_STARTING_AMOUNT_TOO_LARGE');
  });

  it('rejects a growth rate below -10%', () => {
    expectRejection(input({ annualGrowthRate: -10.01 }), 'INVESTMENT_GROWTH_RATE_OUT_OF_RANGE');
  });

  it('rejects a growth rate above 30%', () => {
    expectRejection(input({ annualGrowthRate: 30.01 }), 'INVESTMENT_GROWTH_RATE_OUT_OF_RANGE');
  });

  it('rejects a negative contribution amount', () => {
    expectRejection(input({ contributionAmount: -5 }), 'INVESTMENT_NEGATIVE_CONTRIBUTION');
  });

  it('rejects a contribution amount above the max bound', () => {
    expectRejection(input({ contributionAmount: 1_000_001 }), 'INVESTMENT_CONTRIBUTION_TOO_LARGE');
  });

  it('rejects non-integer years', () => {
    expectRejection(input({ years: 3.5 }), 'INVESTMENT_YEARS_NOT_INTEGER');
  });

  it('rejects years below 1', () => {
    expectRejection(input({ years: 0 }), 'INVESTMENT_HORIZON_INVALID');
  });

  it('rejects years above 100', () => {
    expectRejection(input({ years: 101 }), 'INVESTMENT_HORIZON_INVALID');
  });

  it('rejects non-finite numeric input', () => {
    expectRejection(input({ startingAmount: NaN }), 'INVESTMENT_NON_FINITE_INPUT');
  });
});
