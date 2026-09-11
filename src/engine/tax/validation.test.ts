import { describe, expect, it } from 'vitest';
import { validateFederalTaxInput } from './validation';
import type { FederalTaxInput, TaxPayer } from './types';

function person(age: number, earnedIncome = 0): TaxPayer {
  return { age, earnedIncome };
}

function makeInput(overrides: Partial<FederalTaxInput> = {}): FederalTaxInput {
  return {
    year: 2026,
    filingStatus: 'single',
    ordinaryIncome: 50000,
    preferentialIncome: 0,
    people: [person(40, 50000)],
    indexing: { chainedCpiU: 0.025, averageWageIndex: 0.03 },
    ...overrides,
  };
}

describe('validateFederalTaxInput', () => {
  it('does not throw for a well-formed single input', () => {
    expect(() => validateFederalTaxInput(makeInput())).not.toThrow();
  });

  it('does not throw for a well-formed mfj input', () => {
    expect(() =>
      validateFederalTaxInput(
        makeInput({
          filingStatus: 'mfj',
          ordinaryIncome: 80000,
          people: [person(40, 50000), person(42, 30000)],
        }),
      ),
    ).not.toThrow();
  });

  describe('NON_FINITE_INPUT', () => {
    it.each([
      ['year', { year: NaN }],
      ['ordinaryIncome', { ordinaryIncome: NaN }],
      ['preferentialIncome', { preferentialIncome: Infinity }],
    ])('throws for non-finite %s', (_label, overrides) => {
      try {
        validateFederalTaxInput(makeInput(overrides as Partial<FederalTaxInput>));
        expect.fail('expected throw');
      } catch (e) {
        expect((e as { code: string }).code).toBe('NON_FINITE_INPUT');
      }
    });

    it('throws for non-finite people[i].earnedIncome', () => {
      try {
        validateFederalTaxInput(makeInput({ people: [person(40, NaN)] }));
        expect.fail('expected throw');
      } catch (e) {
        expect((e as { code: string }).code).toBe('NON_FINITE_INPUT');
        expect((e as Error).message).toContain('people[0].earnedIncome');
      }
    });

    it('throws for non-finite people[i].age', () => {
      try {
        validateFederalTaxInput(makeInput({ people: [person(NaN as number, 100)] }));
        expect.fail('expected throw');
      } catch (e) {
        expect((e as { code: string }).code).toBe('NON_FINITE_INPUT');
      }
    });

    it('throws when indexing is not an object with finite numeric fields', () => {
      try {
        validateFederalTaxInput(
          makeInput({ indexing: { chainedCpiU: undefined as unknown as number, averageWageIndex: 0.03 } }),
        );
        expect.fail('expected throw');
      } catch (e) {
        expect((e as { code: string }).code).toBe('NON_FINITE_INPUT');
        expect((e as Error).message).toContain('indexing.chainedCpiU');
      }
    });

    it('throws when indexing itself is undefined', () => {
      try {
        validateFederalTaxInput(makeInput({ indexing: undefined as unknown as FederalTaxInput['indexing'] }));
        expect.fail('expected throw');
      } catch (e) {
        expect((e as { code: string }).code).toBe('NON_FINITE_INPUT');
      }
    });
  });

  describe('TAX_YEAR_NOT_INTEGER', () => {
    it('throws for a fractional year', () => {
      try {
        validateFederalTaxInput(makeInput({ year: 2026.5 }));
        expect.fail('expected throw');
      } catch (e) {
        expect((e as { code: string }).code).toBe('TAX_YEAR_NOT_INTEGER');
        expect((e as Error).message).toBe('year must be a whole number, received 2026.5.');
      }
    });
  });

  describe('TAX_YEAR_OUT_OF_RANGE', () => {
    it('throws below 2026', () => {
      try {
        validateFederalTaxInput(makeInput({ year: 2024 }));
        expect.fail('expected throw');
      } catch (e) {
        expect((e as { code: string }).code).toBe('TAX_YEAR_OUT_OF_RANGE');
      }
    });

    it('throws above 2125', () => {
      try {
        validateFederalTaxInput(makeInput({ year: 2126 }));
        expect.fail('expected throw');
      } catch (e) {
        expect((e as { code: string }).code).toBe('TAX_YEAR_OUT_OF_RANGE');
      }
    });

    it('does not throw at the boundaries', () => {
      expect(() => validateFederalTaxInput(makeInput({ year: 2026 }))).not.toThrow();
      expect(() => validateFederalTaxInput(makeInput({ year: 2125 }))).not.toThrow();
    });
  });

  describe('TAX_FILING_STATUS_UNKNOWN', () => {
    it('throws for an unrecognized filing status', () => {
      try {
        validateFederalTaxInput(makeInput({ filingStatus: 'married' as FederalTaxInput['filingStatus'] }));
        expect.fail('expected throw');
      } catch (e) {
        expect((e as { code: string }).code).toBe('TAX_FILING_STATUS_UNKNOWN');
      }
    });
  });

  describe('TAX_FILING_STATUS_PEOPLE_MISMATCH', () => {
    it('throws when people is empty', () => {
      try {
        validateFederalTaxInput(makeInput({ people: [] }));
        expect.fail('expected throw');
      } catch (e) {
        expect((e as { code: string }).code).toBe('TAX_FILING_STATUS_PEOPLE_MISMATCH');
      }
    });

    it('throws when mfj has only 1 person', () => {
      try {
        validateFederalTaxInput(makeInput({ filingStatus: 'mfj', people: [person(40, 50000)] }));
        expect.fail('expected throw');
      } catch (e) {
        expect((e as { code: string }).code).toBe('TAX_FILING_STATUS_PEOPLE_MISMATCH');
        expect((e as Error).message).toBe('filingStatus "mfj" requires exactly 2 people, received 1.');
      }
    });

    it('throws when single has 2 people', () => {
      try {
        validateFederalTaxInput(makeInput({ people: [person(40, 50000), person(42, 0)] }));
        expect.fail('expected throw');
      } catch (e) {
        expect((e as { code: string }).code).toBe('TAX_FILING_STATUS_PEOPLE_MISMATCH');
      }
    });

    it('throws when people is not an array', () => {
      try {
        validateFederalTaxInput(makeInput({ people: undefined as unknown as TaxPayer[] }));
        expect.fail('expected throw');
      } catch (e) {
        expect((e as { code: string }).code).toBe('TAX_FILING_STATUS_PEOPLE_MISMATCH');
      }
    });
  });

  describe('NEGATIVE_INCOME', () => {
    it('throws for negative ordinaryIncome', () => {
      try {
        validateFederalTaxInput(makeInput({ ordinaryIncome: -100 }));
        expect.fail('expected throw');
      } catch (e) {
        expect((e as { code: string }).code).toBe('NEGATIVE_INCOME');
      }
    });

    it('throws for negative preferentialIncome', () => {
      try {
        validateFederalTaxInput(makeInput({ preferentialIncome: -100 }));
        expect.fail('expected throw');
      } catch (e) {
        expect((e as { code: string }).code).toBe('NEGATIVE_INCOME');
        expect((e as Error).message).toBe('preferentialIncome must not be negative, received -100.');
      }
    });

    it('throws for negative earnedIncome', () => {
      try {
        validateFederalTaxInput(makeInput({ people: [person(40, -1)] }));
        expect.fail('expected throw');
      } catch (e) {
        expect((e as { code: string }).code).toBe('NEGATIVE_INCOME');
      }
    });
  });

  describe('TAX_EARNED_INCOME_EXCEEDS_ORDINARY', () => {
    it('throws when sum of earnedIncome exceeds ordinaryIncome', () => {
      try {
        validateFederalTaxInput(makeInput({ ordinaryIncome: 150000, people: [person(40, 200000)] }));
        expect.fail('expected throw');
      } catch (e) {
        expect((e as { code: string }).code).toBe('TAX_EARNED_INCOME_EXCEEDS_ORDINARY');
        expect((e as Error).message).toBe(
          'the sum of people[].earnedIncome must not exceed ordinaryIncome (earned income is a subset tag, not an additional amount), received 200000 against 150000.',
        );
      }
    });

    it('does not throw when equal within epsilon', () => {
      expect(() =>
        validateFederalTaxInput(makeInput({ ordinaryIncome: 100000, people: [person(40, 100000)] })),
      ).not.toThrow();
    });
  });

  describe('NEGATIVE_AGE', () => {
    it('throws for a negative age', () => {
      try {
        validateFederalTaxInput(makeInput({ people: [person(-1, 0)] }));
        expect.fail('expected throw');
      } catch (e) {
        expect((e as { code: string }).code).toBe('NEGATIVE_AGE');
        expect((e as Error).message).toBe('people[0].age must not be negative, received -1.');
      }
    });
  });

  describe('RATE_BELOW_NEGATIVE_100_PERCENT', () => {
    it('throws for chainedCpiU below -1', () => {
      try {
        validateFederalTaxInput(makeInput({ indexing: { chainedCpiU: -1.5, averageWageIndex: 0.03 } }));
        expect.fail('expected throw');
      } catch (e) {
        expect((e as { code: string }).code).toBe('RATE_BELOW_NEGATIVE_100_PERCENT');
      }
    });

    it('throws for averageWageIndex below -1', () => {
      try {
        validateFederalTaxInput(makeInput({ indexing: { chainedCpiU: 0.025, averageWageIndex: -2 } }));
        expect.fail('expected throw');
      } catch (e) {
        expect((e as { code: string }).code).toBe('RATE_BELOW_NEGATIVE_100_PERCENT');
      }
    });
  });
});
