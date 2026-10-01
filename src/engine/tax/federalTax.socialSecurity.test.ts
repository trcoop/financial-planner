import { describe, expect, it } from 'vitest';
import { computeFederalTax } from './federalTax';
import { resolveTables } from './tables';
import type { FederalTaxInput, TaxPayer } from './types';

const INDEXING = { chainedCpiU: 0.025, averageWageIndex: 0.03 };

function single(overrides: Partial<FederalTaxInput> = {}, person: Partial<TaxPayer> = {}): FederalTaxInput {
  return {
    year: 2026,
    filingStatus: 'single',
    ordinaryIncome: 0,
    preferentialIncome: 0,
    people: [{ age: 65, earnedIncome: 0, ...person }],
    indexing: INDEXING,
    ...overrides,
  };
}

describe('computeFederalTax with Social Security', () => {
  it('no benefits: result fields are zero and magi unchanged', () => {
    const r = computeFederalTax(single({ ordinaryIncome: 40_000 }));
    expect(r.grossSocialSecurity).toBe(0);
    expect(r.taxableSocialSecurity).toBe(0);
    expect(r.provisionalIncome).toBe(40_000);
    expect(r.magi).toBe(40_000);
  });

  it('T6 through the orchestrator: fields, magi and taxable ordinary income', () => {
    const r = computeFederalTax(single({ ordinaryIncome: 30_000 }, { socialSecurityBenefits: 20_000 }));
    expect(r.grossSocialSecurity).toBe(20_000);
    expect(r.provisionalIncome).toBe(40_000);
    expect(r.taxableSocialSecurity).toBe(9_600);
    expect(r.grossOrdinaryIncome).toBe(30_000);
    expect(r.magi).toBe(39_600);
    expect(r.taxableOrdinaryIncome).toBe(39_600 - r.deduction.total);
  });

  it('taxable SS is taxed in the ordinary ladder and preferential stacks above it', () => {
    const base = computeFederalTax(single({ ordinaryIncome: 30_000, preferentialIncome: 10_000 }));
    const withSs = computeFederalTax(
      single({ ordinaryIncome: 30_000, preferentialIncome: 10_000 }, { socialSecurityBenefits: 20_000 }),
    );
    expect(withSs.taxableSocialSecurity).toBeGreaterThan(0);
    expect(withSs.taxOwed).toBeGreaterThan(base.taxOwed);
    expect(withSs.taxableIncome).toBe(
      Math.max(0, 30_000 + 10_000 + withSs.taxableSocialSecurity - withSs.deduction.total),
    );
  });

  it('tax-exempt interest raises provisional income but not magi beyond taxable SS', () => {
    const r = computeFederalTax(
      single({ ordinaryIncome: 20_000, taxExemptInterest: 10_000 }, { socialSecurityBenefits: 20_000 }),
    );
    expect(r.provisionalIncome).toBe(40_000);
    expect(r.taxableSocialSecurity).toBe(9_600);
  });

  it('FICA never applies to benefits', () => {
    const a = computeFederalTax(single({ ordinaryIncome: 30_000 }));
    const b = computeFederalTax(single({ ordinaryIncome: 30_000 }, { socialSecurityBenefits: 20_000 }));
    expect(b.fica).toEqual(a.fica);
  });

  it('two-person MFJ sums both benefits before the worksheet (T8)', () => {
    const r = computeFederalTax({
      year: 2026,
      filingStatus: 'mfj',
      ordinaryIncome: 25_000,
      preferentialIncome: 0,
      people: [
        { age: 67, earnedIncome: 0, socialSecurityBenefits: 12_000 },
        { age: 64, earnedIncome: 0, socialSecurityBenefits: 18_000 },
      ],
      indexing: INDEXING,
    });
    expect(r.grossSocialSecurity).toBe(30_000);
    expect(r.provisionalIncome).toBe(40_000);
    expect(r.taxableSocialSecurity).toBe(4_000);
  });

  it('rounds taxable SS half-up at exactly .5', () => {
    const r = computeFederalTax(single({ ordinaryIncome: 20_000 }, { socialSecurityBenefits: 20_002 }));
    expect(r.taxableSocialSecurity).toBe(2_501);
  });

  it('MFS with benefits throws; MFS without benefits works', () => {
    const mfs = single({ filingStatus: 'mfs', ordinaryIncome: 10_000 }, { socialSecurityBenefits: 1 });
    expect(() => computeFederalTax(mfs)).toThrowError(
      expect.objectContaining({ code: 'TAX_UNSUPPORTED_FILING_STATUS_FOR_SOCIAL_SECURITY' }),
    );
    expect(() =>
      computeFederalTax(single({ filingStatus: 'mfs', ordinaryIncome: 10_000 }, { socialSecurityBenefits: 0 })),
    ).not.toThrow();
  });

  describe('senior-bonus phase-out straddle against the new MAGI', () => {
    const { seniorBonus } = resolveTables(2026, 'single', INDEXING);
    const start = seniorBonus.phaseOutStart;
    const perPerson = seniorBonus.amountPerQualifyingPerson;
    const rate = seniorBonus.phaseOutRate;

    // Ordinary income just below the phase-out start: without SS the bonus is full. With SS
    // (PI far above 34k, 85% cap binds => taxable = 17,000) MAGI crosses the start.
    const ordinary = start - 5_000;
    const benefits = 20_000;

    it('without SS the bonus is undiminished', () => {
      const r = computeFederalTax(single({ ordinaryIncome: ordinary }));
      expect(r.magi).toBe(ordinary);
      expect(r.deduction.seniorBonusDeduction).toBe(perPerson);
    });

    it('with SS taxable SS pushes MAGI past the start and reduces the bonus', () => {
      const r = computeFederalTax(single({ ordinaryIncome: ordinary }, { socialSecurityBenefits: benefits }));
      expect(r.taxableSocialSecurity).toBe(17_000);
      expect(r.magi).toBe(ordinary + 17_000);
      const excess = ordinary + 17_000 - start;
      expect(excess).toBeGreaterThan(0);
      expect(r.deduction.seniorBonusDeduction).toBeCloseTo(perPerson - rate * excess, 6);
      expect(r.deduction.seniorBonusDeduction).toBeLessThan(perPerson);
    });
  });
});
