import { describe, expect, it } from 'vitest';

import { runInvestmentProjection } from './investmentCalculator';
import type { InvestmentProjectionInput } from './investmentCalculator';

/**
 * Independent oracle fixtures (ERD: Investment Calculator §4).
 *
 * Captured by hand, live, from https://www.calculator.net/investment-calculator.html
 * on 2026-08-31 (via browser automation during implementation — a one-time manual
 * data-collection step, not a runtime dependency; per the zero-network-calls
 * constraint, these values are static and checked into the repo, and the tests below
 * make no network call). At least one case per `compoundingFrequency` value, as
 * required, plus a second case each for `annually` and `monthly`, and a same-
 * frequency/same-inputs `monthly` pair isolating `contributionTiming` start vs end.
 *
 * calculator.net's "Contribute at the beginning/end of each month/year" maps directly
 * to our `contributionTiming`/`contributionFrequency`; its "Compound: annually /
 * semiannually / quarterly / monthly / daily" maps directly to our
 * `compoundingFrequency` (camelCase spelling aside).
 *
 * calculator.net displays dollar amounts rounded to the cent, so fixture expectations
 * are compared with `toBeCloseTo(value, 2)` (absolute tolerance of half a cent) rather
 * than the 1e-6 *relative* tolerance used for the hand-computed cases in
 * `investmentCalculator.test.ts` — that finer tolerance is only meaningful against an
 * un-rounded oracle, and applying it here would fail on the source data's own rounding
 * rather than on an algorithm bug.
 */
interface OracleFixture {
  name: string;
  input: InvestmentProjectionInput;
  expected: {
    finalBalance: number;
    totalContributions: number;
    totalGrowth: number;
  };
}

const fixtures: OracleFixture[] = [
  {
    name: 'annually compounding, no contributions',
    input: {
      startingAmount: 10_000,
      annualGrowthRate: 6,
      compoundingFrequency: 'annually',
      contributionAmount: 0,
      contributionFrequency: 'annually',
      contributionTiming: 'end',
      years: 10,
    },
    expected: { finalBalance: 17_908.48, totalContributions: 0, totalGrowth: 7_908.48 },
  },
  {
    // Deliberately uses annual (not monthly) contributions: a live check with
    // monthly contributions under semiannual compounding was captured too, and
    // calculator.net's actual output for that combo ($14,724.03) did *not* match
    // this engine's ERD-decided simple-sum-bucket convention (off by ~$119, i.e.
    // calculator.net appears to grow interim monthly contributions internally
    // rather than bucketing them ungrown until the next compounding boundary).
    // That is a real divergence between the ERD's DECIDED algorithm and
    // calculator.net's live behavior for the "contributions more frequent than
    // compounding" case specifically — noted in the PR description rather than
    // silently worked around. This fixture instead uses the unambiguous case
    // (contribution frequency <= compounding frequency), which matched exactly,
    // to keep semiAnnually coverage in the oracle suite.
    name: 'semiAnnually compounding, annual contributions at end of period',
    input: {
      startingAmount: 5_000,
      annualGrowthRate: 8,
      compoundingFrequency: 'semiAnnually',
      contributionAmount: 600,
      contributionFrequency: 'annually',
      contributionTiming: 'end',
      years: 5,
    },
    expected: { finalBalance: 10_932.43, totalContributions: 3_000, totalGrowth: 2_932.43 },
  },
  {
    name: 'quarterly compounding, annual contributions at start of period',
    input: {
      startingAmount: 2_000,
      annualGrowthRate: 5,
      compoundingFrequency: 'quarterly',
      contributionAmount: 500,
      contributionFrequency: 'annually',
      contributionTiming: 'start',
      years: 7,
    },
    expected: { finalBalance: 7_122.71, totalContributions: 3_500, totalGrowth: 1_622.71 },
  },
  {
    name: 'monthly compounding, monthly contributions at end of period',
    input: {
      startingAmount: 1_000,
      annualGrowthRate: 7,
      compoundingFrequency: 'monthly',
      contributionAmount: 200,
      contributionFrequency: 'monthly',
      contributionTiming: 'end',
      years: 3,
    },
    expected: { finalBalance: 9_218.95, totalContributions: 7_200, totalGrowth: 1_018.95 },
  },
  {
    name: 'daily compounding, no contributions',
    input: {
      startingAmount: 15_000,
      annualGrowthRate: 4,
      compoundingFrequency: 'daily',
      contributionAmount: 0,
      contributionFrequency: 'annually',
      contributionTiming: 'end',
      years: 2,
    },
    expected: { finalBalance: 16_249.23, totalContributions: 0, totalGrowth: 1_249.23 },
  },
  // A second case each for annually and monthly, with different inputs than the
  // fixtures above, so those two frequencies get more than single-case coverage.
  {
    name: 'annually compounding (second case), annual contributions at end of period',
    input: {
      startingAmount: 25_000,
      annualGrowthRate: 5.5,
      compoundingFrequency: 'annually',
      contributionAmount: 1_000,
      contributionFrequency: 'annually',
      contributionTiming: 'end',
      years: 15,
    },
    expected: { finalBalance: 78_220.58, totalContributions: 15_000, totalGrowth: 38_220.58 },
  },
  {
    name: 'monthly compounding (second case), monthly contributions at start of period',
    input: {
      startingAmount: 800,
      annualGrowthRate: 9,
      compoundingFrequency: 'monthly',
      contributionAmount: 50,
      contributionFrequency: 'monthly',
      contributionTiming: 'start',
      years: 4,
    },
    expected: { finalBalance: 4_042.73, totalContributions: 2_400, totalGrowth: 842.73 },
  },
  // Same-frequency, same-inputs pair isolating contributionTiming: identical
  // startingAmount/rate/years/contributionAmount/contributionFrequency, differing
  // only in 'start' vs 'end', directly demonstrating and locking in the timing
  // distinction against the live oracle (rather than incidentally covering both
  // values across otherwise-different cases).
  {
    name: 'monthly compounding, contribution timing start (paired with the end case below)',
    input: {
      startingAmount: 3_000,
      annualGrowthRate: 7,
      compoundingFrequency: 'monthly',
      contributionAmount: 150,
      contributionFrequency: 'monthly',
      contributionTiming: 'start',
      years: 6,
    },
    expected: { finalBalance: 18_012.47, totalContributions: 10_800, totalGrowth: 4_212.47 },
  },
  {
    name: 'monthly compounding, contribution timing end (paired with the start case above)',
    input: {
      startingAmount: 3_000,
      annualGrowthRate: 7,
      compoundingFrequency: 'monthly',
      contributionAmount: 150,
      contributionFrequency: 'monthly',
      contributionTiming: 'end',
      years: 6,
    },
    expected: { finalBalance: 17_934.46, totalContributions: 10_800, totalGrowth: 4_134.46 },
  },
];

describe('runInvestmentProjection — calculator.net oracle fixtures', () => {
  for (const fixture of fixtures) {
    it(`matches calculator.net for: ${fixture.name}`, () => {
      const result = runInvestmentProjection(fixture.input);

      expect(result.finalBalance).toBeCloseTo(fixture.expected.finalBalance, 2);
      expect(result.totalContributions).toBeCloseTo(fixture.expected.totalContributions, 2);
      expect(result.totalGrowth).toBeCloseTo(fixture.expected.totalGrowth, 2);

      // Sum identity, at the engine's own precision (ERD §2).
      const sum = result.totalContributions + result.totalGrowth + fixture.input.startingAmount;
      const relativeError = Math.abs(sum - result.finalBalance) / Math.abs(result.finalBalance);
      expect(relativeError).toBeLessThan(1e-6);
    });
  }
});
