import { describe, expect, it } from 'vitest';

import { GOLDEN_G7 } from './goldenFixtures';
import { growthBalance } from './growth';

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
}

describe('growthBalance (PRD E12, ERD G7)', () => {
  it('G7: 12 payments of 1,000 at 4.5% effective annual -> 12,245.53 (not the r/12 12,250.62)', () => {
    const out = growthBalance(GOLDEN_G7.monthly, GOLDEN_G7.growthRate);
    expect(out).toHaveLength(12);
    expect(out[11]).toBeCloseTo(12245.53, 1);
    expect(Math.abs(out[11] - 12250.62)).toBeGreaterThan(1);
  });

  it('grow-then-add: the first benefit earns no growth in its own month', () => {
    const out = growthBalance([1000, 0], 0.045);
    expect(out[0]).toBe(1000);
    expect(out[1]).toBeCloseTo(1000 * 1.045 ** (1 / 12), 10);
  });

  it('null rate is a plain cumulative sum; 0 is a legal ON value giving the same numbers', () => {
    expect(growthBalance([1, 2, 3], null)).toEqual([1, 3, 6]);
    expect(growthBalance([1, 2, 3], 0)).toEqual([1, 3, 6]);
  });

  it('empty input gives an empty series', () => {
    expect(growthBalance([], 0.05)).toEqual([]);
  });

  it('balance is 0 before the first benefit month', () => {
    expect(growthBalance([0, 0, 500], 0.1).slice(0, 2)).toEqual([0, 0]);
  });

  it('validates the rate and the stream', () => {
    expect(codeOf(() => growthBalance([1], -0.01))).toBe('SS_INVALID_GROWTH_RATE');
    expect(codeOf(() => growthBalance([1], 0.2501))).toBe('SS_INVALID_GROWTH_RATE');
    expect(codeOf(() => growthBalance([1], Number.NaN))).toBe('NON_FINITE_INPUT');
    expect(codeOf(() => growthBalance([1, Number.POSITIVE_INFINITY], null))).toBe('NON_FINITE_INPUT');
  });
});
