import { describe, expect, it } from 'vitest';

import { collectingPia, legalClaimWindow } from './benefit';
import { GOLDEN_FIXTURES, GOLDEN_G7 } from './goldenFixtures';
import type { GoldenKey } from './goldenFixtures';

const KEYS: GoldenKey[] = [
  'G1', 'G3', 'G4', 'G5', 'G6', 'G9', 'G10', 'G11a', 'G11b', 'E28a', 'E28b', 'E28c',
  'E29', 'E33a', 'E33b', 'E33c', 'E33d', 'E33e', 'E40', 'E41',
]; // prettier-ignore

describe('goldenFixtures spec (inputs only)', () => {
  it('has exactly the Round 5 key set', () => {
    expect(Object.keys(GOLDEN_FIXTURES).sort()).toEqual([...KEYS].sort());
  });

  it.each(KEYS)('%s: frozen conventions and valid inputs', (key) => {
    const { inputs, expected } = GOLDEN_FIXTURES[key];
    const june = key === 'G11a' || key === 'G11b';
    expect(inputs.asOf).toEqual({ year: 2026, month: june ? 6 : 9 });
    expect(inputs.growthRate).toBeNull();
    expect(expected.checks.length).toBeGreaterThan(0);
    expect(inputs.claimMonth).toHaveLength(inputs.people.length);
    inputs.people.forEach((p, i) => {
      const claim = inputs.claimMonth[i];
      if (p.benefit.kind === 'collecting') {
        expect(claim).toBeNull();
        expect(collectingPia(p, inputs.asOf)).toBeGreaterThanOrEqual(0); // validates window + check
      } else {
        const w = legalClaimWindow(p, inputs.asOf);
        expect(w).not.toBeNull();
        expect(claim).toBeGreaterThanOrEqual(w?.earliest as number);
        expect(claim).toBeLessThanOrEqual(w?.latest as number);
      }
    });
  });

  it('G7 growth stream: 1,000 x 12 at 4.5% matches the recursion to the cent', () => {
    const g = (1 + GOLDEN_G7.growthRate) ** (1 / 12);
    let bal = 0;
    for (const x of GOLDEN_G7.monthly) bal = bal * g + x;
    expect(GOLDEN_G7.monthly).toHaveLength(12);
    expect(bal).toBeCloseTo(GOLDEN_G7.expected, 2);
  });

  it('E33 totals reproduce by hand', () => {
    expect(275 * 2000 * (845 / 1200)).toBeCloseTo(387291.67, 2);
    expect(180 * 2480).toBeCloseTo(446400, 2);
    expect(216 * 2000).toBeCloseTo(432000, 2);
    expect(7 * 2080 + 197 * 2160).toBeCloseTo(440080, 2);
    expect(8 * 2400 + 173 * 2000 * (1 + 35 / 150)).toBeCloseTo(445933.33, 2);
  });

  it('survivor goldens reproduce by hand', () => {
    expect(2800 * (1 - (0.285 * 25) / 84)).toBeCloseTo(2562.5, 2);
    expect(3024 * (1 - (0.285 * 25) / 84)).toBeCloseTo(2767.5, 2);
    expect(3024 * (1 - 0.285 / 84)).toBeCloseTo(3013.74, 2);
    expect(2800 * (1 - (0.285 * 83) / 84)).toBeCloseTo(2011.5, 2);
    expect(Math.max((2800 * 845) / 1200, 0.825 * 2800)).toBeCloseTo(2310, 2);
  });
});
