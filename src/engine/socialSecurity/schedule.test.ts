import { describe, expect, it } from 'vitest';

import { InvalidProjectionInputError } from '../errors';
import { computeOwnAndSpousal } from './spousal';
import { buildSsAnnualSchedule } from './schedule';
import type { SsInputs, SsPerson } from './types';

type Inputs = Omit<SsInputs, 'deathAgeYears'>;

const mi = (year: number, month: number): number => year * 12 + (month - 1);
const asOf = { year: 2026, month: 9 };

const piaPerson = (birthYear: number, birthMonth: number, pia: number): SsPerson => ({
  birthYear,
  birthMonth,
  benefit: { kind: 'pia', pia },
});
const collecting = (birthYear: number, birthMonth: number, check: number, sinceMonth: number): SsPerson => ({
  birthYear,
  birthMonth,
  benefit: { kind: 'collecting', check, sinceMonth },
});

const base = (people: Inputs['people'], claimMonth: Inputs['claimMonth']): Omit<Inputs, 'endYear'> => ({
  asOf,
  colaRate: 0,
  growthRate: null,
  people,
  claimMonth,
});

describe('buildSsAnnualSchedule', () => {
  it('collecting person contributes 12 months of the current check in year 0 (full calendar year)', () => {
    const s = buildSsAnnualSchedule(base([collecting(1960, 3, 2000, mi(2023, 4))], [null]), 2028);
    expect(s).toEqual([
      { year: 2026, personIndex: 0, nominalAnnual: 24000 },
      { year: 2027, personIndex: 0, nominalAnnual: 24000 },
      { year: 2028, personIndex: 0, nominalAnnual: 24000 },
    ]);
  });

  it('year 0 is the full calendar year, unlike calculator-start totals from the asOf month', () => {
    const inputs = base([collecting(1960, 3, 2000, mi(2023, 4))], [null]);
    const plan = buildSsAnnualSchedule(inputs, 2026)[0].nominalAnnual;
    // Calculator-start fixture: only Sep-Dec (4 months) of 2026 would count.
    const calcStartTotal = 2000 * (12 - (asOf.month - 1));
    expect(calcStartTotal).toBe(8000);
    expect(plan).toBe(24000);
  });

  it('rounds once, half-up, to whole dollars (.5 rounds up)', () => {
    const up = buildSsAnnualSchedule(base([collecting(1960, 3, 83.375, mi(2023, 4))], [null]), 2026);
    expect(up[0].nominalAnnual).toBe(1001);
    const down = buildSsAnnualSchedule(base([collecting(1960, 3, 83.3, mi(2023, 4))], [null]), 2026);
    expect(down[0].nominalAnnual).toBe(1000);
  });

  it('equals Math.round of the unrounded engine annual per person-year', () => {
    const inputs: Inputs = { ...base([piaPerson(1960, 3, 2000.37)], [mi(2027, 4)]), colaRate: 0.025, endYear: 2032 };
    const raw = computeOwnAndSpousal(inputs).annual;
    const { endYear: _end, ...rest } = inputs; const s = buildSsAnnualSchedule(rest, 2032);
    expect(s).toHaveLength(raw.length);
    raw.forEach((row, i) => {
      expect(s[i]).toEqual({ year: row.year, personIndex: 0, nominalAnnual: Math.round(row.perPerson[0].total) });
    });
    expect(s[0].nominalAnnual).toBe(0);
    expect(s[1].nominalAnnual).toBeGreaterThan(0);
  });

  it('sorts by year then personIndex and includes spousal', () => {
    const args = base([piaPerson(1962, 5, 3000), piaPerson(1964, 8, 800)], [mi(2027, 6), mi(2030, 9)]);
    const s = buildSsAnnualSchedule(args, 2031);
    const keys = s.map((r) => [r.year, r.personIndex]);
    expect(keys).toEqual([...keys].sort((a, b) => a[0] - b[0] || a[1] - b[1]));
    expect(s).toHaveLength(12);
    const last = computeOwnAndSpousal({ ...args, endYear: 2031 }).annual.at(-1)!;
    expect(s[10].nominalAnnual).toBe(Math.round(last.perPerson[0].total));
    expect(s[11].nominalAnnual).toBe(Math.round(last.perPerson[1].total));
    expect(s[11].nominalAnnual).toBeGreaterThan(0);
  });

  it('clamps a stale claim (<= asOf month) to firstClaimableMonth(asOf), never throws', () => {
    const person = piaPerson(1962, 5, 2000);
    const stale = buildSsAnnualSchedule(base([person], [mi(2026, 3)]), 2028);
    const oct = buildSsAnnualSchedule(base([person], [mi(2026, 10)]), 2028);
    expect(stale).toEqual(oct);
    expect(stale[0].nominalAnnual).toBeGreaterThan(0);
    expect(buildSsAnnualSchedule(base([person], [mi(2026, 9)]), 2028)).toEqual(oct);
    const later = buildSsAnnualSchedule(base([person], [mi(2027, 1)]), 2028);
    expect(later[0].nominalAnnual).toBe(0);
  });

  it('does not clamp other invalid claims: non-stale pre-62 and post-70 claims throw their own codes', () => {
    expect(codeOf(() => buildSsAnnualSchedule(base([piaPerson(1990, 5, 2000)], [mi(2030, 1)]), 2040))).toBe(
      'SS_CLAIM_BEFORE_ELIGIBLE',
    );
    expect(codeOf(() => buildSsAnnualSchedule(base([piaPerson(1962, 5, 2000)], [mi(2033, 1)]), 2040))).toBe(
      'SS_CLAIM_AFTER_70',
    );
  });

  it('emits one row per person-year (year-major) for a couple with a $0-PIA spouse', () => {
    const s = buildSsAnnualSchedule(
      base([piaPerson(1962, 5, 2000), piaPerson(1962, 5, 0)], [mi(2027, 6), mi(2027, 6)]),
      2030,
    );
    expect(s.map((r) => [r.year, r.personIndex])).toEqual(
      [2026, 2027, 2028, 2029, 2030].flatMap((y) => [
        [y, 0],
        [y, 1],
      ]),
    );
  });

  it.each<[string, Inputs['people'] | null, number, string]>([
    ['horizon before asOf year', null, 2025, 'SS_INVALID_AS_OF'],
    ['non-integer horizon', null, 2026.5, 'SS_INVALID_AS_OF'],
    ['NaN horizon', null, Number.NaN, 'NON_FINITE_INPUT'],
    ['empty people', [] as unknown as Inputs['people'], 2030, 'SS_SPOUSAL_INPUT_ON_SINGLE'],
    [
      'three people',
      [piaPerson(1962, 5, 1), piaPerson(1962, 5, 1), piaPerson(1962, 5, 1)] as unknown as Inputs['people'],
      2030,
      'SS_SPOUSAL_INPUT_ON_SINGLE',
    ],
  ])('validates: %s', (_name, people, horizon, code) => {
    const args = base(people ?? [piaPerson(1962, 5, 2000)], people ? [] : [mi(2027, 1)]);
    expect(codeOf(() => buildSsAnnualSchedule(args, horizon))).toBe(code);
  });
});

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof InvalidProjectionInputError) return e.code;
    throw e;
  }
  return undefined;
}
