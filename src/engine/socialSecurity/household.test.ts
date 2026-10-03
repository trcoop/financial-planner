import { describe, expect, it } from 'vitest';

import { GOLDEN_FIXTURES } from './goldenFixtures';
import type { GoldenCheck, GoldenKey } from './goldenFixtures';
import { computeSocialSecurity } from './household';
import { computeOwnAndSpousal } from './spousal';
import type { SsInputs, SsPerson, SsResult } from './types';

const mi = (year: number, month: number): number => year * 12 + (month - 1);
const asOf = { year: 2026, month: 9 };

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
}

const piaPerson = (birthYear: number, birthMonth: number, pia: number): SsPerson => ({
  birthYear,
  birthMonth,
  benefit: { kind: 'pia', pia },
});

const at = (r: SsResult, person: number, month: number) => r.series[person][month - r.firstMonth];
const hh = (r: SsResult, person: number, month: number) => {
  const s = at(r, person, month);
  return s.own + s.spousal + s.survivor;
};

const KEYS = Object.keys(GOLDEN_FIXTURES) as GoldenKey[];

describe('computeSocialSecurity: golden fixtures', () => {
  const personChecks = KEYS.flatMap((key) =>
    GOLDEN_FIXTURES[key].expected.checks
      .filter((c): c is Extract<GoldenCheck, { personIndex: 0 | 1 }> => 'personIndex' in c)
      .map((c) => [key, c] as const),
  );
  it.each(personChecks)('%s %j', (key, c) => {
    const r = computeSocialSecurity(GOLDEN_FIXTURES[key].inputs);
    const s = at(r, c.personIndex, c.month);
    const actual = c.component === 'household' ? s.own + s.spousal + s.survivor : s[c.component];
    expect(actual).toBeCloseTo(c.amount, 2);
  });
});

describe('computeSocialSecurity: composition', () => {
  const base: SsInputs = {
    asOf,
    colaRate: 0.02,
    growthRate: null,
    people: [piaPerson(1964, 12, 2000), piaPerson(1966, 3, 900)],
    claimMonth: [mi(2031, 12), mi(2030, 4)],
    endYear: 2040,
  };

  it('with no deaths it equals computeOwnAndSpousal exactly', () => {
    expect(computeSocialSecurity(base)).toEqual(computeOwnAndSpousal(base));
    expect(computeSocialSecurity({ ...base, deathAgeYears: [null, null] })).toEqual(computeOwnAndSpousal(base));
  });

  it('annual is exactly the sum of each year\'s 12 series months, household = sum of persons', () => {
    const r = computeSocialSecurity({ ...base, deathAgeYears: [75, 80] });
    expect(r.annual.length).toBeGreaterThan(0);
    for (const row of r.annual) {
      let household = 0;
      row.perPerson.forEach((p, i) => {
        let own = 0;
        let spousal = 0;
        let survivor = 0;
        for (let k = 0; k < 12; k++) {
          const s = r.series[i][row.year * 12 + k - r.firstMonth];
          own += s.own;
          spousal += s.spousal;
          survivor += s.survivor;
        }
        expect(p.own).toBeCloseTo(own, 8);
        expect(p.spousal).toBeCloseTo(spousal, 8);
        expect(p.survivor).toBeCloseTo(survivor, 8);
        expect(p.total).toBeCloseTo(own + spousal + survivor, 8);
        household += p.total;
      });
      expect(row.household).toBeCloseTo(household, 8);
    }
  });
});

describe('computeSocialSecurity: death and survivor rules (PRD E10, E37)', () => {
  // E29 shape: husband (P0, PIA 2,800, b. June 1960) claims June 2030, dies June 2032 at 72y0m.
  // Wife (P1, PIA 1,000, b. June 1962) claims June 2029. Survivor 3,472 from June 2032.
  const e29 = GOLDEN_FIXTURES.E29.inputs;
  const dm = mi(2032, 6);

  it('deceased is paid through the month before the death month; survivor from the death month', () => {
    const r = computeSocialSecurity(e29);
    expect(at(r, 0, dm - 1).own).toBeGreaterThan(0);
    expect(at(r, 0, dm)).toEqual({ own: 0, spousal: 0, survivor: 0 });
    expect(at(r, 0, dm + 5)).toEqual({ own: 0, spousal: 0, survivor: 0 });
    expect(at(r, 1, dm)).toEqual({ own: 0, spousal: 0, survivor: expect.closeTo(3472, 2) });
    expect(at(r, 1, dm - 1).survivor).toBe(0);
    expect(r.deathMonths).toEqual([dm, null]);
  });

  it('survivor never receives own + survivor: the larger one wins; own wins when larger', () => {
    // Make the wife\'s own much bigger than the husband-derived survivor.
    const r = computeSocialSecurity({
      ...e29,
      people: [piaPerson(1960, 6, 1000), piaPerson(1962, 6, 3000)],
      claimMonth: [mi(2030, 6), mi(2032, 6)],
      deathAgeYears: [72, null],
    });
    const s = at(r, 1, mi(2035, 1));
    expect(s.survivor).toBe(0);
    expect(s.own).toBeGreaterThan(3000);
    expect(s.spousal).toBe(0);
  });

  it('same-month deaths: neither is paid for that month and no survivor amount is ever paid', () => {
    const r = computeSocialSecurity({ ...e29, deathAgeYears: [72, 70] });
    expect(r.deathMonths).toEqual([dm, dm]);
    for (const i of [0, 1]) {
      expect(hh(r, i, dm)).toBe(0);
      expect(hh(r, i, dm + 24)).toBe(0);
    }
    expect(hh(r, 1, dm - 1)).toBeGreaterThan(0);
    expect(r.starts.some((s) => s.kind === 'survivor')).toBe(false);
  });

  it('survivor dying the month after pays exactly one survivor month (the deceased\'s death month)', () => {
    const r = computeSocialSecurity({ ...e29, deathAgeYears: [72, 841 / 12] });
    expect(at(r, 1, dm).survivor).toBeCloseTo(3472, 2);
    expect(hh(r, 1, dm + 1)).toBe(0);
    expect(hh(r, 1, dm + 12)).toBe(0);
  });

  it('survivor dying first: roles flip, the earlier death is the deceased', () => {
    const r = computeSocialSecurity({ ...e29, deathAgeYears: [75, 66] });
    // wife dies first (age 66 -> June 2028); husband not yet claimed -> died-before-claiming base is irrelevant here
    expect(r.deathMonths[1]).toBe(mi(2028, 6));
    expect(hh(r, 1, mi(2028, 6))).toBe(0);
    expect(hh(r, 0, mi(2030, 6))).toBeGreaterThan(0);
  });

  it('spousal top-up ends for the survivor at the death month (replaced by the survivor comparison) and COLA applies once', () => {
    const g3 = GOLDEN_FIXTURES.G3.inputs; // Sally P0 (PIA 1,200), Jeff P1 (PIA 3,500, claims FRA June 2032), COLA 1.5%
    const r = computeSocialSecurity({ ...g3, endYear: 2050, deathAgeYears: [null, 80] }); // Jeff dies June 2045
    const death = mi(2045, 6);
    expect(at(r, 0, death - 1).spousal).toBeGreaterThan(0);
    const s = at(r, 0, death);
    expect(s.spousal).toBe(0);
    expect(s.own).toBe(0);
    expect(s.survivor).toBeCloseTo(3500 * 1.015 ** (2045 - 2026), 6);
  });

  it('survivor under 60 at the death month waits for 60y1m (E41) and is flagged deferredTo60', () => {
    const r = computeSocialSecurity(GOLDEN_FIXTURES.E41.inputs);
    expect(r.starts).toContainEqual({ personIndex: 1, kind: 'survivor', month: mi(2028, 4), deferredTo60: true });
    expect(hh(r, 1, mi(2028, 3))).toBe(0);
    // the deceased's own start (Dec 2030) is after his death, so it is not a start event
    expect(r.starts.some((s) => s.personIndex === 0)).toBe(false);
  });

  it('survivor start at the death month carries no deferredTo60 key; starts are month-ordered', () => {
    const r = computeSocialSecurity(e29);
    const surv = r.starts.find((s) => s.kind === 'survivor');
    expect(surv).toEqual({ personIndex: 1, kind: 'survivor', month: dm });
    expect('deferredTo60' in (surv ?? {})).toBe(false);
    const months = r.starts.map((s) => s.month);
    expect(months).toEqual([...months].sort((a, b) => a - b));
  });

  it('starts: own before survivor in the same month; a survivor spousal start at/after the death month is dropped', () => {
    // Wife (PIA 1,000, b. June 1962) claims June 2032 (age 70) = the husband's death month, so her own
    // start, her would-be spousal start (400 top-up) and the survivor start all land in June 2032.
    const r = computeSocialSecurity({ ...e29, claimMonth: [mi(2030, 6), mi(2032, 6)] });
    expect(r.starts).toEqual([
      { personIndex: 0, kind: 'own', month: mi(2030, 6) },
      { personIndex: 1, kind: 'own', month: dm },
      { personIndex: 1, kind: 'survivor', month: dm },
    ]);
    // the survivor's own start stays an event even though the survivor amount wins (the own claim is the real filing)
    expect(at(r, 1, dm).own).toBe(0);
  });

  it('starts are sorted by month: a survivor start precedes the survivor\'s later own start', () => {
    // Wife b. June 1966 (66y0m at the June 2032 death) claims at 70 (June 2036); survivor pays from June 2032.
    const r = computeSocialSecurity({
      ...e29,
      people: [piaPerson(1960, 6, 2800), piaPerson(1966, 6, 1000)],
      claimMonth: [mi(2030, 6), mi(2036, 6)],
      endYear: 2040,
    });
    expect(r.starts).toEqual([
      { personIndex: 0, kind: 'own', month: mi(2030, 6) },
      { personIndex: 1, kind: 'survivor', month: dm },
      { personIndex: 1, kind: 'own', month: mi(2036, 6) },
    ]);
  });

  it('a start in exactly the person\'s death month is not listed (they are never paid that month)', () => {
    // Husband claims June 2030 at 70 and dies June 2030 (age 70.0): his own start == his death month.
    const r = computeSocialSecurity({ ...e29, deathAgeYears: [70, null] });
    expect(r.starts).toEqual([
      { personIndex: 1, kind: 'own', month: mi(2029, 6) },
      { personIndex: 1, kind: 'survivor', month: mi(2030, 6) },
    ]);
  });

  it('a collecting person dies: only their remaining months are cut off', () => {
    const r = computeSocialSecurity(GOLDEN_FIXTURES.G4.inputs);
    expect(r.deathMonths[0]).toBe(mi(2027, 5));
    expect(hh(r, 0, mi(2027, 4))).toBeGreaterThan(0);
    expect(hh(r, 0, mi(2027, 5))).toBe(0);
  });
});

describe('computeSocialSecurity: validation', () => {
  const single: SsInputs = {
    asOf,
    colaRate: 0,
    growthRate: null,
    people: [piaPerson(1964, 12, 2000)],
    claimMonth: [mi(2031, 12)],
    endYear: 2040,
  };
  it('death before the asOf month, above 120, or non-finite', () => {
    // born Dec 1964: age 61.75 at Sep 2026
    expect(codeOf(() => computeSocialSecurity({ ...single, deathAgeYears: [61] }))).toBe('SS_INVALID_DEATH');
    expect(codeOf(() => computeSocialSecurity({ ...single, deathAgeYears: [120.5] }))).toBe('SS_INVALID_DEATH');
    expect(codeOf(() => computeSocialSecurity({ ...single, deathAgeYears: [Number.NaN] }))).toBe('NON_FINITE_INPUT');
    expect(codeOf(() => computeSocialSecurity({ ...single, deathAgeYears: [62, null] }))).toBe(
      'SS_SPOUSAL_INPUT_ON_SINGLE',
    );
  });
  it('death in the asOf month is legal; death age below claim age is legal (E13)', () => {
    expect(codeOf(() => computeSocialSecurity({ ...single, deathAgeYears: [(2026 * 12 + 8 - (1964 * 12 + 11)) / 12] }))).toBeUndefined();
    const r = computeSocialSecurity({ ...single, deathAgeYears: [65] });
    expect(r.annual.reduce((s, row) => s + row.household, 0)).toBe(0);
  });
  it('still surfaces computeOwnAndSpousal validation', () => {
    expect(codeOf(() => computeSocialSecurity({ ...single, colaRate: 0.5 }))).toBe('SS_INVALID_COLA');
  });
});
