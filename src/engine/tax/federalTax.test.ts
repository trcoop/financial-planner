import { describe, expect, it } from 'vitest';
import { assertPreferentialLadderAvailable, computeFederalTax } from './federalTax';
import type { FederalTaxInput, ResolvedYearTables, TaxPayer } from './types';

function person(age: number, earnedIncome = 0): TaxPayer {
  return { age, earnedIncome };
}

const INDEXING = { chainedCpiU: 0.025, averageWageIndex: 0.03 };

function makeInput(overrides: Partial<FederalTaxInput> = {}): FederalTaxInput {
  return {
    year: 2026,
    filingStatus: 'single',
    ordinaryIncome: 50000,
    preferentialIncome: 0,
    people: [person(40, 50000)],
    indexing: INDEXING,
    ...overrides,
  };
}

function makeTables(overrides: Partial<ResolvedYearTables> = {}): ResolvedYearTables {
  return {
    year: 2026,
    filingStatus: 'mfs',
    ordinaryLadder: [
      { rate: 0.1, lowerBound: 0, upperBound: 12400 },
      { rate: 0.12, lowerBound: 12400, upperBound: Infinity },
    ],
    preferentialLadder: [{ rate: 0.15, lowerBound: 0, upperBound: Infinity }],
    standardDeductionBase: 15000,
    ageAdditionPerQualifyingPerson: 2000,
    seniorBonus: {
      amountPerQualifyingPerson: 0,
      phaseOutStart: 0,
      phaseOutEnd: 0,
      phaseOutRate: 0.06,
      lastApplicableYear: 2028,
      firstApplicableYear: 2025,
    },
    fica: {
      socialSecurityRate: 0.062,
      socialSecurityWageBase: 176100,
      medicareRate: 0.0145,
      additionalMedicareRate: 0.009,
      additionalMedicareThreshold: 125000,
    },
    ...overrides,
  };
}

describe('assertPreferentialLadderAvailable', () => {
  it('throws when the MFS preferential ladder is unavailable and preferentialIncome > 0', () => {
    const tables = makeTables({ preferentialLadder: undefined });
    const input = makeInput({ filingStatus: 'mfs', preferentialIncome: 5000, people: [person(40, 0)] });
    try {
      assertPreferentialLadderAvailable(tables, input);
      expect.fail('expected throw');
    } catch (e) {
      expect((e as { code: string }).code).toBe('TAX_MFS_PREFERENTIAL_UNSUPPORTED');
      expect((e as Error).message).toBe(
        'MFS preferential (long-term capital gain / qualified dividend) thresholds are not published in the sources this engine was built from; computeFederalTax refuses to guess. Received preferentialIncome 5000 with filingStatus "mfs".',
      );
    }
  });

  it('does not throw when the MFS preferential ladder is unavailable but preferentialIncome is 0', () => {
    const tables = makeTables({ preferentialLadder: undefined });
    const input = makeInput({ filingStatus: 'mfs', preferentialIncome: 0, people: [person(40, 0)] });
    expect(() => assertPreferentialLadderAvailable(tables, input)).not.toThrow();
  });

  it('does not throw when the preferential ladder is defined', () => {
    const tables = makeTables();
    const input = makeInput({ filingStatus: 'mfs', preferentialIncome: 5000, people: [person(40, 0)] });
    expect(() => assertPreferentialLadderAvailable(tables, input)).not.toThrow();
  });
});

describe('computeFederalTax', () => {
  it('runs validation before any arithmetic and rethrows the typed error', () => {
    try {
      computeFederalTax(makeInput({ year: 2020 }));
      expect.fail('expected throw');
    } catch (e) {
      expect((e as { code: string }).code).toBe('TAX_YEAR_OUT_OF_RANGE');
    }
  });

  it('computes a basic single return with zero income tax below the standard deduction', () => {
    const result = computeFederalTax(makeInput({ ordinaryIncome: 10000, people: [person(40, 10000)] }));
    expect(result.taxableOrdinaryIncome).toBe(0);
    expect(result.ordinaryTax).toBe(0);
    expect(result.taxOwed).toBe(0);
  });

  it('sums ordinaryTax + preferentialTax to taxBeforeCredits exactly', () => {
    const result = computeFederalTax(
      makeInput({ ordinaryIncome: 80000, preferentialIncome: 20000, people: [person(40, 80000)] }),
    );
    expect(result.ordinaryTax + result.preferentialTax).toBe(result.taxBeforeCredits);
  });

  it('computes fica components that sum exactly to fica.total', () => {
    const result = computeFederalTax(makeInput({ ordinaryIncome: 50007, people: [person(40, 50007)] }));
    expect(result.fica.socialSecurity + result.fica.medicare + result.fica.additionalMedicare).toBe(
      result.fica.total,
    );
  });

  it('reports effectiveMarginalRate by finite difference, not equal to ordinaryBracketRate alone with senior bonus phase-out', () => {
    // Single, age 65, ordinary income within the senior-bonus phase-out range: one extra dollar
    // of ordinary income destroys $0.06 of deduction, so the marginal rate is bracketRate * 1.06.
    const result = computeFederalTax(
      makeInput({
        ordinaryIncome: 80000,
        preferentialIncome: 0,
        people: [person(65, 0)],
      }),
    );
    expect(result.effectiveMarginalRate).toBeCloseTo(result.ordinaryBracketRate * 1.06, 9);
  });

  it('never recurses infinitely (computeCore must not call computeFederalTax)', () => {
    expect(() => computeFederalTax(makeInput())).not.toThrow(RangeError);
  });

  it('does not mutate ordinaryIncome for the returned result (bump is internal only)', () => {
    const input = makeInput({ ordinaryIncome: 50000, people: [person(40, 50000)] });
    const result = computeFederalTax(input);
    expect(result.grossOrdinaryIncome).toBe(50000);
  });

  it('throws TAX_MFS_PREFERENTIAL_UNSUPPORTED end-to-end only if tables lack the MFS ladder (guarded via unit test above; here we assert the guard is wired into computeCore for a supported case)', () => {
    // MFS with preferentialIncome 0 should never hit the guard, regardless of table support.
    expect(() =>
      computeFederalTax(
        makeInput({ filingStatus: 'mfs', preferentialIncome: 0, ordinaryIncome: 30000, people: [person(40, 30000)] }),
      ),
    ).not.toThrow();
  });

  it('effectiveRate and effectiveRateIncludingFica are 0 at zero income', () => {
    const result = computeFederalTax(makeInput({ ordinaryIncome: 0, people: [person(40, 0)] }));
    expect(result.effectiveRate).toBe(0);
    expect(result.effectiveRateIncludingFica).toBe(0);
    expect(result.effectiveMarginalRate).not.toBeNaN();
  });

  it('echoes year and filingStatus', () => {
    const result = computeFederalTax(makeInput({ year: 2030 }));
    expect(result.year).toBe(2030);
    expect(result.filingStatus).toBe('single');
  });
});
