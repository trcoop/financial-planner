import { describe, expect, it } from 'vitest';
import { resolveIndexedAmount, resolveIndexedLadder } from './indexing';
import type { IndexedAmount, IndexedLadder, IndexingRates } from './types';

const rates: IndexingRates = { chainedCpiU: 0.025, averageWageIndex: 0.035 };

describe('resolveIndexedAmount', () => {
  it('returns the published actual exactly, regardless of policy kind', () => {
    const entry: IndexedAmount = {
      published: { 2026: 100, 2027: 105 },
      policy: { kind: 'chained-cpi-u', baseYear: 2016, rounding: { kind: 'truncate', increment: 50 } },
      source: 'test',
      confidence: 'confirmed',
    };
    expect(resolveIndexedAmount(entry, 2026, rates)).toBe(100);
    expect(resolveIndexedAmount(entry, 2027, rates)).toBe(105);
  });

  it('frozen policy never compounds', () => {
    const entry: IndexedAmount = {
      published: { 2026: 200_000 },
      policy: { kind: 'frozen' },
      source: 'test',
      confidence: 'confirmed',
    };
    expect(resolveIndexedAmount(entry, 2027, rates)).toBe(200_000);
    expect(resolveIndexedAmount(entry, 2076, rates)).toBe(200_000);
  });

  it('statutory-rate policy never compounds', () => {
    const entry: IndexedAmount = {
      published: { 2026: 0.009 },
      policy: { kind: 'statutory-rate' },
      source: 'test',
      confidence: 'confirmed',
    };
    expect(resolveIndexedAmount(entry, 2027, rates)).toBe(0.009);
    expect(resolveIndexedAmount(entry, 2076, rates)).toBe(0.009);
  });

  it('sunset policy returns the flat base with no gating (year-gating is out of scope)', () => {
    const entry: IndexedAmount = {
      published: { 2026: 6000 },
      policy: { kind: 'sunset', lastApplicableYear: 2028 },
      source: 'test',
      confidence: 'confirmed',
    };
    // Even a year past `lastApplicableYear` returns the flat value — gating is a different
    // function's (seniorBonusAppliesInYear's) job.
    expect(resolveIndexedAmount(entry, 2030, rates)).toBe(6000);
  });

  it('chained-cpi-u truncates to $50 vs $25 increment differently (floor, not round)', () => {
    const base50: IndexedAmount = {
      published: { 2026: 10_000 },
      policy: { kind: 'chained-cpi-u', baseYear: 2016, rounding: { kind: 'truncate', increment: 50 } },
      source: 'test',
      confidence: 'confirmed',
    };
    const base25: IndexedAmount = {
      published: { 2026: 10_000 },
      policy: { kind: 'chained-cpi-u', baseYear: 2016, rounding: { kind: 'truncate', increment: 25 } },
      source: 'test',
      confidence: 'confirmed',
    };
    // A rate/base/n chosen so the $50 and $25 truncation floors land on different multiples of
    // $25 (i.e. floor(raw / 25) is odd) — otherwise both increments coincidentally truncate to
    // the same value and the test would not distinguish them.
    const customRates: IndexingRates = { chainedCpiU: 0.078, averageWageIndex: 0.035 };
    const n = 1;
    const year = 2026 + n;
    const raw = 10_000 * (1 + customRates.chainedCpiU) ** n; // 10,780

    const resolved50 = resolveIndexedAmount(base50, year, customRates);
    const resolved25 = resolveIndexedAmount(base25, year, customRates);

    expect(resolved50).toBe(Math.floor(raw / 50) * 50);
    expect(resolved25).toBe(Math.floor(raw / 25) * 25);
    expect(resolved50).not.toBe(resolved25);
    // Confirm it's truncation (floor), not rounding: resolved values must never exceed raw.
    expect(resolved50).toBeLessThanOrEqual(raw);
    expect(resolved25).toBeLessThanOrEqual(raw);
  });

  it('average-wage-index rounds to nearest $300, not truncated', () => {
    const entry: IndexedAmount = {
      published: { 2026: 176_100 },
      policy: { kind: 'average-wage-index', rounding: { kind: 'nearest', increment: 300 }, lagYears: 2 },
      source: 'test',
      confidence: 'confirmed',
    };
    const n = 1;
    const year = 2027;
    const raw = 176_100 * (1 + rates.averageWageIndex) ** n; // 182,263.5
    const truncated = Math.floor(raw / 300) * 300;
    const nearest = Math.round(raw / 300) * 300;

    // Pick a scenario where truncation and nearest-rounding disagree, to prove it's not
    // accidentally using truncateTo.
    expect(truncated).not.toBe(nearest);
    expect(resolveIndexedAmount(entry, year, rates)).toBe(nearest);
  });

  it('lag-cancellation: the exponent is year - lastPublishedYear, never adjusted by lagYears', () => {
    // lagYears is type-pinned to the literal 2 for average-wage-index (ERD §5.5: it documents
    // statutory provenance only, since the published actual already embeds its own lag) — it
    // can never actually vary between fixtures. So the discriminator has to be an exact expected
    // value: a mutant computing n = year - lastPublishedYear - lagYears (n=2 instead of n=4) would
    // produce a different rounded result than the correct n = year - lastPublishedYear.
    const entry: IndexedAmount = {
      published: { 2026: 10_000 },
      policy: { kind: 'average-wage-index', rounding: { kind: 'nearest', increment: 300 }, lagYears: 2 },
      source: 'test',
      confidence: 'confirmed',
    };
    const year = 2030; // correct n = 4; a "- lagYears" mutant would use n = 2
    const correctRaw = 10_000 * Math.pow(1 + rates.averageWageIndex, 4);
    const mutantRaw = 10_000 * Math.pow(1 + rates.averageWageIndex, 2);
    const correctRounded = Math.round(correctRaw / 300) * 300;
    const mutantRounded = Math.round(mutantRaw / 300) * 300;
    expect(correctRounded).not.toBe(mutantRounded);
    expect(resolveIndexedAmount(entry, year, rates)).toBe(correctRounded);
  });
});

describe('resolveIndexedLadder', () => {
  it('returns the published ladder exactly for a published year', () => {
    const entry: IndexedLadder = {
      published: {
        2026: [
          { rate: 0.1, lowerBound: 0, upperBound: 50_000 },
          { rate: 0.22, lowerBound: 50_000, upperBound: Infinity },
        ],
      },
      policy: { kind: 'chained-cpi-u', baseYear: 2016, rounding: { kind: 'truncate', increment: 50 } },
      source: 'test',
      confidence: 'confirmed',
    };
    expect(resolveIndexedLadder(entry, 2026, rates)).toEqual(entry.published[2026]);
  });

  it('indexes bounds forward but never touches rate, and Infinity/0 pass through', () => {
    const entry: IndexedLadder = {
      published: {
        2026: [
          { rate: 0.1, lowerBound: 0, upperBound: 50_000 },
          { rate: 0.22, lowerBound: 50_000, upperBound: Infinity },
        ],
      },
      policy: { kind: 'chained-cpi-u', baseYear: 2016, rounding: { kind: 'truncate', increment: 50 } },
      source: 'test',
      confidence: 'confirmed',
    };
    const result = resolveIndexedLadder(entry, 2027, rates);
    expect(result[0].lowerBound).toBe(0);
    expect(result[0].rate).toBe(0.1);
    expect(result[1].upperBound).toBe(Infinity);
    expect(result[1].rate).toBe(0.22);

    const raw = 50_000 * (1 + rates.chainedCpiU) ** 1;
    const expectedBound = Math.floor(raw / 50) * 50;
    expect(result[0].upperBound).toBe(expectedBound);
    expect(result[1].lowerBound).toBe(expectedBound);
  });
});
