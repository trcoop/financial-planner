import { describe, expect, it } from 'vitest';
import { computeDeductions, magiForV1, seniorBonusAppliesInYear } from './deductions';
import type { ResolvedYearTables, TaxPayer } from './types';

/** Minimal ResolvedYearTables stub — deductions.ts is value-indifferent about table
 * provenance (that's WP-C), so these numbers are arbitrary-but-fixed for test purposes. */
function makeTables(overrides: Partial<ResolvedYearTables> = {}): ResolvedYearTables {
  return {
    year: 2026,
    filingStatus: 'single',
    ordinaryLadder: [],
    preferentialLadder: [],
    standardDeductionBase: 15000,
    ageAdditionPerQualifyingPerson: 2000,
    seniorBonus: {
      amountPerQualifyingPerson: 6000,
      phaseOutStart: 150000,
      phaseOutEnd: 250000,
      phaseOutRate: 0.06,
      lastApplicableYear: 2028,
      firstApplicableYear: 2025,
    },
    fica: {
      socialSecurityRate: 0.062,
      socialSecurityWageBase: 176100,
      medicareRate: 0.0145,
      additionalMedicareRate: 0.009,
      additionalMedicareThreshold: 200000,
    },
    ...overrides,
  };
}

function person(age: number, earnedIncome = 0): TaxPayer {
  return { age, earnedIncome };
}

describe('seniorBonusAppliesInYear', () => {
  it('is false for 2024', () => {
    expect(seniorBonusAppliesInYear(2024)).toBe(false);
  });
  it('is true for 2025 (below the public API year range, only reachable directly)', () => {
    expect(seniorBonusAppliesInYear(2025)).toBe(true);
  });
  it('is true for 2028', () => {
    expect(seniorBonusAppliesInYear(2028)).toBe(true);
  });
  it('is false for 2029 (inclusive-2028 bound, not an exclusive-2029 bound)', () => {
    expect(seniorBonusAppliesInYear(2029)).toBe(false);
  });
});

describe('magiForV1', () => {
  it('sums ordinary and preferential income', () => {
    expect(magiForV1(100000, 25000)).toBe(125000);
  });
});

describe('computeDeductions', () => {
  it('age 64 does not qualify for age addition or senior bonus', () => {
    const tables = makeTables();
    const result = computeDeductions(tables, [person(64)], 'single', 2026, 0, 0);
    expect(result.ageAddition).toBe(0);
    expect(result.seniorBonusDeduction).toBe(0);
    expect(result.standardDeduction).toBe(15000);
  });

  it('age 65 qualifies for age addition and senior bonus', () => {
    const tables = makeTables();
    const result = computeDeductions(tables, [person(65)], 'single', 2026, 0, 0);
    expect(result.ageAddition).toBe(2000);
    expect(result.standardDeduction).toBe(17000);
    expect(result.seniorBonusDeduction).toBe(6000);
  });

  it('mixed-age joint return: only the qualifying spouse counts', () => {
    const tables = makeTables();
    const result = computeDeductions(
      tables,
      [person(65), person(60)],
      'mfj',
      2026,
      0,
      0,
    );
    expect(result.ageAddition).toBe(2000); // one qualifying person
    expect(result.seniorBonusDeduction).toBe(6000); // one qualifying person's bonus
  });

  it('single qualifying person: phase-out arithmetic at $200,000 MAGI', () => {
    const tables = makeTables();
    // excess = 200000 - 150000 = 50000; perPerson = 6000 - 0.06*50000 = 3000
    const result = computeDeductions(tables, [person(65)], 'single', 2026, 200000, 0);
    expect(result.seniorBonusDeduction).toBe(3000);
  });

  it('two qualifying people (MFJ): per-taxpayer phase-out against the SAME joint MAGI at $200,000', () => {
    const tables = makeTables();
    // Each spouse independently: perPerson = 6000 - 0.06*(200000-150000) = 3000
    // total = 3000 * 2 = 6000 (NOT the pooled-formula's wrong answer)
    const result = computeDeductions(
      tables,
      [person(65), person(70)],
      'mfj',
      2026,
      200000,
      0,
    );
    expect(result.seniorBonusDeduction).toBe(6000);
  });

  it('two qualifying people (MFJ): bonus reaches exactly zero at $250,000 joint MAGI', () => {
    const tables = makeTables();
    const result = computeDeductions(
      tables,
      [person(65), person(70)],
      'mfj',
      2026,
      250000,
      0,
    );
    expect(result.seniorBonusDeduction).toBe(0);
  });

  it('MFS is ineligible for the senior bonus regardless of age or MAGI, even well below phase-out start', () => {
    const tables = makeTables();
    const result = computeDeductions(tables, [person(70)], 'mfs', 2026, 10000, 0);
    expect(result.seniorBonusDeduction).toBe(0);
  });

  it('senior bonus is 0 outside the 2025-2028 window even for an otherwise-qualifying taxpayer', () => {
    const tables = makeTables();
    const before = computeDeductions(tables, [person(65)], 'single', 2029, 0, 0);
    expect(before.seniorBonusDeduction).toBe(0);
  });

  it('standardDeduction and seniorBonusDeduction are distinct fields that sum to total', () => {
    const tables = makeTables();
    const result = computeDeductions(tables, [person(65), person(60)], 'mfj', 2026, 100000, 0);
    expect(result.standardDeduction).toBe(result.base + result.ageAddition);
    expect(result.total).toBe(result.standardDeduction + result.seniorBonusDeduction);
    expect(result.standardDeduction).not.toBe(result.total);
  });
});
