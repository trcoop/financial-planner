import { describe, expect, it } from 'vitest';
import { InvalidProjectionInputError } from '../errors';
import { computeTaxableSocialSecurity } from './socialSecurity';
import type { FilingStatus } from './types';

function run(filingStatus: FilingStatus, benefits: number, otherAgi: number, taxExemptInterest = 0) {
  return computeTaxableSocialSecurity({ benefits, otherAgi, taxExemptInterest, filingStatus });
}

describe('computeTaxableSocialSecurity (ERD §12.2 vectors)', () => {
  const vectors: Array<[string, FilingStatus, number, number, number, number]> = [
    ['T1', 'single', 20_000, 0, 10_000, 0],
    ['T2', 'single', 20_000, 15_000, 25_000, 0],
    ['T3', 'single', 20_000, 20_000, 30_000, 2_500],
    ['T4', 'single', 4_000, 30_000, 32_000, 2_000],
    ['T5', 'single', 20_000, 24_000, 34_000, 4_500],
    ['T6', 'single', 20_000, 30_000, 40_000, 9_600],
    ['T7', 'single', 20_000, 100_000, 110_000, 17_000],
    ['T8', 'mfj', 30_000, 25_000, 40_000, 4_000],
    ['T9', 'mfj', 30_000, 29_000, 44_000, 6_000],
    ['T10', 'mfj', 30_000, 40_000, 55_000, 15_350],
    ['T11', 'hoh', 20_000, 30_000, 40_000, 9_600],
  ];
  it.each(vectors)('%s', (_n, status, b, agi, pi, taxable) => {
    expect(run(status, b, agi)).toEqual({ provisionalIncome: pi, taxable });
  });

  it('T12: MFS with benefits > 0 throws the typed code', () => {
    expect(() => run('mfs', 10_000, 0)).toThrowError(InvalidProjectionInputError);
    try {
      run('mfs', 10_000, 0);
    } catch (e) {
      expect((e as InvalidProjectionInputError).code).toBe('TAX_UNSUPPORTED_FILING_STATUS_FOR_SOCIAL_SECURITY');
    }
  });

  it('MFS with zero benefits is unchanged', () => {
    expect(run('mfs', 0, 50_000)).toEqual({ provisionalIncome: 50_000, taxable: 0 });
  });

  it('tax-exempt interest counts toward provisional income', () => {
    expect(run('single', 20_000, 20_000, 10_000)).toEqual({ provisionalIncome: 40_000, taxable: 9_600 });
  });

  it('rounds exactly .5 half-up (2500.5 -> 2501)', () => {
    // PI = 20000 + 10001 = 30001; 0.5 * (30001 - 25000) = 2500.5
    expect(run('single', 20_002, 20_000)).toEqual({ provisionalIncome: 30_001, taxable: 2_501 });
  });
});
