import { describe, expect, it } from 'vitest';
import { bandRateAt, ladderTax, occupyLadder } from './brackets';
import type { Ladder } from './types';

/** A simplified single-filer-shaped preferential ladder for shift tests: 0% up to 55,550,
 * 15% from there to 551,600, 20% above. Matches the ERD §5.3 worked example. */
const PREFERENTIAL_LADDER: Ladder = [
  { rate: 0, lowerBound: 0, upperBound: 49_450 },
  { rate: 0.15, lowerBound: 49_450, upperBound: 551_600 },
  { rate: 0.2, lowerBound: 551_600, upperBound: Infinity },
];

/** A simplified ordinary-shaped ladder for boundary/zero/infinity tests. */
const ORDINARY_LADDER: Ladder = [
  { rate: 0.1, lowerBound: 0, upperBound: 12_400 },
  { rate: 0.12, lowerBound: 12_400, upperBound: 50_000 },
  { rate: 0.22, lowerBound: 50_000, upperBound: Infinity },
];

describe('occupyLadder', () => {
  it('negative shift: does not push band 0 floor above 0 (ERD §5.3 worked example)', () => {
    // shift = 10,000 - 16,100 = -6,100
    const result = occupyLadder(PREFERENTIAL_LADDER, 60_000, -6_100);

    expect(result[0].lowerBound).toBe(0);
    expect(result[0].upperBound).toBe(55_550); // 49,450 - (-6,100)
    expect(result[0].incomeInThisBracket).toBe(55_550);
    expect(result[0].taxFromThisBracket).toBe(0);

    expect(result[1].lowerBound).toBe(55_550);
    expect(result[1].upperBound).toBe(551_600 + 6_100);
    expect(result[1].incomeInThisBracket).toBe(4_450);
    expect(result[1].taxFromThisBracket).toBeCloseTo(667.5);

    const totalOccupied = result.reduce((sum, b) => sum + b.incomeInThisBracket, 0);
    expect(totalOccupied).toBe(60_000);
  });

  it('positive shift: degenerates the 0% band to [0,0) with zero occupancy', () => {
    // shift = 100,000 - 16,100 = 83,900
    const result = occupyLadder(PREFERENTIAL_LADDER, 20_000, 83_900);

    expect(result[0].lowerBound).toBe(0);
    expect(result[0].upperBound).toBe(0); // max(0, 49,450 - 83,900)
    expect(result[0].incomeInThisBracket).toBe(0);
    expect(result[0].taxFromThisBracket).toBe(0);

    // 15% band's shifted lower is also clamped to 0
    expect(result[1].lowerBound).toBe(0);
    expect(result[1].incomeInThisBracket).toBe(20_000);
    expect(result[1].taxFromThisBracket).toBeCloseTo(3_000);
  });

  it('boundary occupancy vs. marginal lookup disagree correctly at a boundary', () => {
    const result = occupyLadder(ORDINARY_LADDER, 12_400, 0);

    // occupancy: the whole 12,400 sits in band 0, band 1 is empty
    expect(result[0].incomeInThisBracket).toBe(12_400);
    expect(result[1].incomeInThisBracket).toBe(0);

    // marginal lookup: 12,400 falls in [12_400, 50_000)
    expect(bandRateAt(ORDINARY_LADDER, 12_400)).toBe(0.12);
  });

  it('returns every band, including fully unoccupied ones', () => {
    const result = occupyLadder(ORDINARY_LADDER, 5_000, 0);

    expect(result).toHaveLength(3);
    expect(result[0].incomeInThisBracket).toBe(5_000);
    expect(result[1].incomeInThisBracket).toBe(0);
    expect(result[2].incomeInThisBracket).toBe(0);
    expect(result[2].upperBound).toBe(Infinity);
  });

  it('handles the Infinity top band with income far beyond all finite bounds', () => {
    const result = occupyLadder(ORDINARY_LADDER, 10_000_000, 0);

    expect(result[2].upperBound).toBe(Infinity);
    expect(result[2].lowerBound).toBe(50_000);
    expect(result[2].incomeInThisBracket).toBe(10_000_000 - 50_000);
    expect(result[2].taxFromThisBracket).toBeCloseTo((10_000_000 - 50_000) * 0.22);
  });

  it('zero income: every band reports zero occupancy without throwing', () => {
    const result = occupyLadder(ORDINARY_LADDER, 0, 0);

    for (const band of result) {
      expect(band.incomeInThisBracket).toBe(0);
      expect(band.taxFromThisBracket).toBe(0);
    }
  });

  it('degenerate [0,0) bands have zero occupancy and do not throw', () => {
    const degenerateLadder: Ladder = [
      { rate: 0, lowerBound: 0, upperBound: 0 },
      { rate: 0.1, lowerBound: 0, upperBound: 10_000 },
      { rate: 0.2, lowerBound: 10_000, upperBound: Infinity },
    ];

    expect(() => occupyLadder(degenerateLadder, 5_000, 0)).not.toThrow();
    const result = occupyLadder(degenerateLadder, 5_000, 0);
    expect(result[0].lowerBound).toBe(0);
    expect(result[0].upperBound).toBe(0);
    expect(result[0].incomeInThisBracket).toBe(0);
  });
});

describe('bandRateAt', () => {
  it('returns the first band rate at amount 0', () => {
    expect(bandRateAt(ORDINARY_LADDER, 0)).toBe(0.1);
  });

  it('returns the unique band rate for an amount strictly inside a band', () => {
    expect(bandRateAt(ORDINARY_LADDER, 30_000)).toBe(0.12);
  });

  it('returns the top band rate for an amount far beyond all finite bounds', () => {
    expect(bandRateAt(ORDINARY_LADDER, 10_000_000)).toBe(0.22);
  });
});

describe('ladderTax', () => {
  it('sums unrounded taxFromThisBracket across all bands', () => {
    expect(ladderTax(ORDINARY_LADDER, 60_000, 0)).toBeCloseTo(
      12_400 * 0.1 + (50_000 - 12_400) * 0.12 + (60_000 - 50_000) * 0.22,
    );
  });

  it('is zero at zero income', () => {
    expect(ladderTax(ORDINARY_LADDER, 0, 0)).toBe(0);
  });

  it('matches the ERD §5.3 negative-shift worked example total of $667.50', () => {
    expect(ladderTax(PREFERENTIAL_LADDER, 60_000, -6_100)).toBeCloseTo(667.5);
  });
});
