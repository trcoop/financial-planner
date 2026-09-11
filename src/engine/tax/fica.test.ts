import { describe, expect, it } from 'vitest';
import { computeFica } from './fica';
import type { FicaParameters, FilingStatus, TaxPayer } from './types';

/**
 * Representative FICA parameters for a single test year. Values match the ERD §4.2 example
 * figures ($200,000 single/hoh, $250,000 mfj, $125,000 mfs Additional Medicare thresholds) —
 * fica.ts never hardcodes these itself, they're always caller-supplied via `FicaParameters`.
 */
const WAGE_BASE = 176_100;

const THRESHOLD_BY_STATUS: Record<FilingStatus, number> = {
  single: 200_000,
  mfj: 250_000,
  mfs: 125_000,
  hoh: 200_000,
};

function paramsFor(filingStatus: FilingStatus): FicaParameters {
  return {
    socialSecurityRate: 0.062,
    socialSecurityWageBase: WAGE_BASE,
    medicareRate: 0.0145,
    additionalMedicareRate: 0.009,
    additionalMedicareThreshold: THRESHOLD_BY_STATUS[filingStatus],
  };
}

function person(earnedIncome: number, age = 40): TaxPayer {
  return { earnedIncome, age };
}

describe('computeFica', () => {
  it('caps Social Security separately per person on a dual-earner joint return', () => {
    const params = paramsFor('mfj');
    const people = [person(300_000), person(250_000)];

    const result = computeFica(params, people);

    // Two full wage bases, not one combined wage base.
    expect(result.socialSecurity).toBe(Math.round(2 * WAGE_BASE * params.socialSecurityRate));
  });

  it('applies Social Security exactly at, and on either side of, the wage base', () => {
    const params = paramsFor('single');

    const below = computeFica(params, [person(WAGE_BASE - 1)]);
    const at = computeFica(params, [person(WAGE_BASE)]);
    const above = computeFica(params, [person(WAGE_BASE + 1)]);

    // Social Security is the largest raw component here (6.2% > 1.45% of the same base, and
    // Additional Medicare is 0 below the threshold), so it's `allocateRounding`'s remainder
    // recipient: total minus the independently-rounded Medicare component, not a plain
    // Math.round of Social Security alone.
    expect(below.socialSecurity).toBe(below.total - below.medicare);
    expect(at.socialSecurity).toBe(at.total - at.medicare);
    expect(above.socialSecurity).toBe(above.total - above.medicare);

    // Capped at the wage base once earned income reaches it, and stays capped just above it —
    // a $1 difference in raw uncapped Social Security can vanish under whole-dollar rounding,
    // so the "not yet capped below the base" side is asserted with a income gap wide enough
    // that no rounding tie can hide it.
    const wellBelow = computeFica(params, [person(WAGE_BASE - 1_000)]);
    expect(wellBelow.socialSecurity).toBeLessThan(at.socialSecurity);
    expect(at.socialSecurity).toBe(above.socialSecurity);
  });

  it.each<FilingStatus>(['single', 'mfj', 'mfs', 'hoh'])(
    'applies Additional Medicare exactly at, and on either side of, the %s threshold',
    (filingStatus) => {
      const params = paramsFor(filingStatus);
      const threshold = THRESHOLD_BY_STATUS[filingStatus];

      const below = computeFica(params, [person(threshold - 1)]);
      const at = computeFica(params, [person(threshold)]);
      const above = computeFica(params, [person(threshold + 1)]);

      expect(below.additionalMedicare).toBe(0);
      expect(at.additionalMedicare).toBe(0);
      // A $1 excess rounds to $0 regardless of the real threshold value, so this trio alone
      // can't detect a threshold shifted by even a few dollars — see the larger-excess pair
      // below, which straddles a rounding boundary specifically so a +-1 shift in the
      // threshold used for the comparison flips the (nonzero) rounded result.
      expect(above.additionalMedicare).toBe(Math.round(1 * params.additionalMedicareRate));
    },
  );

  it.each<FilingStatus>(['single', 'mfj', 'mfs', 'hoh'])(
    'distinguishes a shifted %s Additional Medicare threshold via a rounding-boundary excess',
    (filingStatus) => {
      const params = paramsFor(filingStatus);
      const threshold = THRESHOLD_BY_STATUS[filingStatus];

      // At 0.9% these two straddle a half-up rounding boundary ($55 excess -> $0.495 rounds to
      // $0, $56 excess -> $0.504 rounds to $1). If the threshold used in the excess calculation
      // is off by +1, the $56 case's effective excess becomes $55 and its rounded value drops
      // to $0. If it's off by -1, the $55 case's effective excess becomes $56 and its rounded
      // value jumps to $1. Together the pair catches a +-1 shift in either direction, which a
      // plain +-$1 probe (rounding to $0 either way) cannot.
      const justBelowBoundary = computeFica(params, [person(threshold + 55)]);
      const justAboveBoundary = computeFica(params, [person(threshold + 56)]);

      expect(justBelowBoundary.additionalMedicare).toBe(Math.round(55 * params.additionalMedicareRate));
      expect(justAboveBoundary.additionalMedicare).toBe(Math.round(56 * params.additionalMedicareRate));
    },
  );

  it('reports additionalMedicare === 0 at $50,007 combined earned income', () => {
    const params = paramsFor('single');
    const result = computeFica(params, [person(50_007)]);
    expect(result.additionalMedicare).toBe(0);
  });

  it('reports additionalMedicare === 0 at $1,010 combined earned income', () => {
    const params = paramsFor('mfs');
    const result = computeFica(params, [person(1_010)]);
    expect(result.additionalMedicare).toBe(0);
  });

  it('lets uncapped Medicare exceed capped Social Security at $1,000,000 of earned income', () => {
    const params = paramsFor('single');
    const result = computeFica(params, [person(1_000_000)]);

    const expectedSs = Math.round(WAGE_BASE * params.socialSecurityRate);
    const expectedMedicare = Math.round(1_000_000 * params.medicareRate);
    const expectedAdditionalMedicare = Math.round(
      (1_000_000 - params.additionalMedicareThreshold) * params.additionalMedicareRate,
    );

    expect(result.socialSecurity).toBe(expectedSs);
    expect(result.medicare).toBe(expectedMedicare);
    expect(result.medicare).toBeGreaterThan(result.socialSecurity);
    expect(result.additionalMedicare).toBe(expectedAdditionalMedicare);
  });

  it('computes Additional Medicare on COMBINED household income for a 2-person mfj return', () => {
    const params = paramsFor('mfj');
    // Combined $350,000 vs. the $250,000 mfj threshold -> $100,000 excess. Neither person
    // individually exceeds the threshold, so this fails if the implementation mistakenly
    // sums per-person excess instead of computing excess over the combined household total.
    // The rate is taken from `params` (not hardcoded here) so doubling
    // `additionalMedicareRate` in the implementation is also caught.
    const people = [person(200_000), person(150_000)];

    const result = computeFica(params, people);

    const expected = Math.round(
      (200_000 + 150_000 - params.additionalMedicareThreshold) * params.additionalMedicareRate,
    );
    expect(expected).toBe(900);
    expect(result.additionalMedicare).toBe(expected);
  });

  it('never assigns the rounding remainder to additionalMedicare (P13, exact-sum property)', () => {
    const cases: Array<{ filingStatus: FilingStatus; incomes: number[] }> = [
      { filingStatus: 'single', incomes: [1] },
      { filingStatus: 'single', incomes: [12_345.67] },
      { filingStatus: 'mfj', incomes: [176_100.5, 176_100.5] },
      { filingStatus: 'mfj', incomes: [300_000.33, 10_000.33] },
      { filingStatus: 'mfs', incomes: [125_000.5] },
      { filingStatus: 'hoh', incomes: [999_999.99] },
      { filingStatus: 'single', incomes: [0] },
      { filingStatus: 'mfj', incomes: [50_000.1, 60_000.2] },
      // Constructed so the three raw components round in genuinely conflicting directions:
      // socialSecurity raw = 10,918.20 (frac .2, rounds down), medicare raw = 2,900.802140...
      // (frac .8, rounds UP), additionalMedicare raw = 0.49788... (frac just under .5, rounds
      // down). Naively rounding each component independently gives 10,918 + 2,901 + 0 =
      // 13,819, but the correctly-rounded total is round(13,819.50002) = 13,820 -- a genuine
      // one-dollar conflict that only `allocateRounding`'s remainder assignment closes.
      // Deleting `allocateRounding` (independent per-component `roundHalfUp`) fails this case.
      { filingStatus: 'single', incomes: [200_055.32] },
    ];

    for (const { filingStatus, incomes } of cases) {
      const params = paramsFor(filingStatus);
      const people = incomes.map((income) => person(income));
      const result = computeFica(params, people);

      expect(result.socialSecurity + result.medicare + result.additionalMedicare).toBe(
        result.total,
      );
      expect(Number.isInteger(result.socialSecurity)).toBe(true);
      expect(Number.isInteger(result.medicare)).toBe(true);
      expect(Number.isInteger(result.additionalMedicare)).toBe(true);
      expect(Number.isInteger(result.total)).toBe(true);
    }
  });

  it('sums per-person Medicare uncapped across a dual-earner joint return', () => {
    const params = paramsFor('mfj');
    const people = [person(300_000), person(250_000)];

    const result = computeFica(params, people);

    expect(result.medicare).toBe(Math.round(550_000 * params.medicareRate));
  });
});
