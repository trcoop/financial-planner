import { describe, expect, it } from 'vitest';
import { allocateRounding, roundHalfUp, roundToNearest, truncateTo } from './rounding';

describe('roundHalfUp', () => {
  it('rounds half up', () => {
    expect(roundHalfUp(3100.434)).toBe(3100);
    expect(roundHalfUp(725.5)).toBe(726);
    expect(roundHalfUp(0)).toBe(0);
  });
});

describe('truncateTo', () => {
  it('truncates down to the increment (§1(f)(7))', () => {
    expect(truncateTo(1234, 50)).toBe(1200);
    expect(truncateTo(1249, 50)).toBe(1200);
    expect(truncateTo(1250, 50)).toBe(1250);
    expect(truncateTo(1234, 25)).toBe(1225);
  });
});

describe('roundToNearest', () => {
  it('rounds to the nearest increment, not down', () => {
    // 176,100 is not a multiple of 300; nearest $300 rounds up here.
    expect(roundToNearest(176_100, 300)).toBe(176_100);
    expect(roundToNearest(176_249, 300)).toBe(176_100);
    expect(roundToNearest(176_251, 300)).toBe(176_400);
  });
});

describe('allocateRounding', () => {
  it('gives the remainder to the largest unrounded component', () => {
    // 100 + 50 -> rounds to 150 (exact), largest (100) unaffected by remainder logic here.
    const result = allocateRounding([100, 50], 150);
    expect(result).toEqual([100, 50]);
  });

  it('tie-break: earliest index wins on equal unrounded values', () => {
    // Both components are 100.5 (round to 100 or 101 individually); total 201.
    // Naive rounding: 101 + 101 = 202 !== 201. The earliest index (0) must absorb the remainder.
    const result = allocateRounding([100.5, 100.5], 201);
    expect(result).toEqual([100, 101]);
    expect(result[0] + result[1]).toBe(201);
  });

  it('counterexample 1: $50,007 earner — remainder must not go to the last/zero component', () => {
    // SS 3,100.434, Medicare 725.1015, additionalMedicare 0 (exactly). Sum unrounded 3,825.5355
    // rounds to total 3,826. Naive "remainder to last" would produce additionalMedicare: 1,
    // which is nonsensical since additionalMedicare is exactly 0 for this earner.
    const result = allocateRounding([3100.434, 725.1015, 0], 3826);
    expect(result).toEqual([3101, 725, 0]);
  });

  it('counterexample 2: $1,010 earner — remainder must not go negative on the last component', () => {
    // SS 62.62, Medicare 14.645, additionalMedicare 0. Sum unrounded 77.265 rounds to 77.
    // Naive "remainder to last" (77 - round(62.62) - round(14.645) = 77 - 63 - 15 = -1) would
    // produce additionalMedicare: -1, which must never happen (tax can never be negative).
    // Per the largest-gets-the-remainder rule, SS (the largest, unrounded) absorbs the
    // remainder instead: 77 - round(14.645) - round(0) = 77 - 15 - 0 = 62.
    const result = allocateRounding([62.62, 14.645, 0], 77);
    expect(result).toEqual([62, 15, 0]);
    expect(result.every((n) => n >= 0)).toBe(true);
    expect(result.reduce((a, b) => a + b, 0)).toBe(77);
  });

  it('the allocated components always sum exactly to total', () => {
    const total = 3826;
    const result = allocateRounding([3100.434, 725.1015, 0], total);
    expect(result.reduce((a, b) => a + b, 0)).toBe(total);
  });
});
