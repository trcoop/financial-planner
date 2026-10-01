import { beforeAll, describe, expect, it } from 'vitest';

import { InvalidProjectionInputError } from '../errors';
import type { ProjectionErrorCode } from '../errors';
import { GOLDEN_FIXTURES } from './goldenFixtures';
import type { GoldenKey } from './goldenFixtures';
import { computeOwnAndSpousal, spousalAmount } from './spousal';
import type { SsInputs, SsPerson, SsResult, SsStartKind } from './types';

type Inputs = Omit<SsInputs, 'deathAgeYears'>;

const mi = (year: number, month: number): number => year * 12 + (month - 1);
const asOf = { year: 2026, month: 9 };

function codeOf(fn: () => unknown): ProjectionErrorCode | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof InvalidProjectionInputError) return e.code;
    throw e;
  }
  return undefined;
}

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

function couple(a: SsPerson, b: SsPerson, claimA: number | null, claimB: number | null, endYear = 2045): Inputs {
  return { asOf, colaRate: 0, growthRate: null, people: [a, b], claimMonth: [claimA, claimB], endYear };
}

const at = (r: SsResult, person: number, month: number) => r.series[person][month - r.firstMonth];

/** Own+spousal inputs of a golden (golden inputs may carry deathAgeYears; this path never reads it). */
function goldenInputs(key: GoldenKey): Inputs {
  return GOLDEN_FIXTURES[key].inputs;
}

describe('spousalAmount (ERD section 4, PRD E6/E22)', () => {
  const fra = mi(2032, 6); // calendar month index of the claimant's own FRA

  it('E6: 24 months before FRA keeps 83.3333% of the $400 top-up = $333.33', () => {
    const v = spousalAmount({ ownPia: 1000, otherPia: 2800, ownFraMonths: fra, spousalStart: fra - 24 });
    expect(v).toBeCloseTo(333.33, 2);
    expect(v).toBeCloseTo(400 * (1 - (24 * 25) / 36 / 100), 10);
  });

  it('E22: first legal month (59 months early) keeps 65.4167% of the top-up', () => {
    const v = spousalAmount({ ownPia: 0, otherPia: 2000, ownFraMonths: fra, spousalStart: fra - 59 });
    expect(v / 1000).toBeCloseTo(0.654167, 6);
  });

  it('reduction is 25/36 % per month for 36 months, then 5/12 % per month', () => {
    const base = (m: number) => spousalAmount({ ownPia: 0, otherPia: 2000, ownFraMonths: fra, spousalStart: fra - m });
    expect(base(36)).toBeCloseTo(1000 * 0.75, 8);
    expect(base(37)).toBeCloseTo(1000 * (0.75 - 0.05 / 12), 8);
    expect(base(48)).toBeCloseTo(1000 * 0.7, 8);
    expect(base(1)).toBeCloseTo(1000 * (1 - 0.25 / 36), 8);
  });

  it('gets nothing from delay: at or after FRA the full top-up, never more', () => {
    const at0 = spousalAmount({ ownPia: 300, otherPia: 2000, ownFraMonths: fra, spousalStart: fra });
    const later = spousalAmount({ ownPia: 300, otherPia: 2000, ownFraMonths: fra, spousalStart: fra + 40 });
    expect(at0).toBe(700);
    expect(later).toBe(700);
  });

  it('is 0 (never negative) when own PIA is at or above half the other PIA', () => {
    expect(spousalAmount({ ownPia: 1000, otherPia: 2000, ownFraMonths: fra, spousalStart: fra })).toBe(0);
    expect(spousalAmount({ ownPia: 1500, otherPia: 2000, ownFraMonths: fra, spousalStart: fra - 30 })).toBe(0);
  });

  it('is 0 when the other person has a $0 benefit', () => {
    expect(spousalAmount({ ownPia: 0, otherPia: 0, ownFraMonths: fra, spousalStart: fra })).toBe(0);
  });

  it('throws typed errors for non-finite and negative inputs', () => {
    const ok = { ownPia: 100, otherPia: 2000, ownFraMonths: fra, spousalStart: fra };
    expect(codeOf(() => spousalAmount({ ...ok, ownPia: Number.NaN }))).toBe('NON_FINITE_INPUT');
    expect(codeOf(() => spousalAmount({ ...ok, otherPia: Number.POSITIVE_INFINITY }))).toBe('NON_FINITE_INPUT');
    expect(codeOf(() => spousalAmount({ ...ok, ownFraMonths: Number.NaN }))).toBe('NON_FINITE_INPUT');
    expect(codeOf(() => spousalAmount({ ...ok, spousalStart: Number.NaN }))).toBe('NON_FINITE_INPUT');
    expect(codeOf(() => spousalAmount({ ...ok, ownPia: -1 }))).toBe('SS_NEGATIVE_BENEFIT');
    expect(codeOf(() => spousalAmount({ ...ok, otherPia: -1 }))).toBe('SS_NEGATIVE_BENEFIT');
  });
});

describe('computeOwnAndSpousal: shape', () => {
  let g3: SsResult;
  beforeAll(() => {
    g3 = computeOwnAndSpousal(goldenInputs('G3'));
  });

  it('window runs January of asOf.year through December of endYear, dense', () => {
    expect(g3.firstMonth).toBe(2026 * 12);
    expect(g3.lastMonth).toBe(2040 * 12 + 11);
    expect(g3.series).toHaveLength(2);
    for (const s of g3.series) expect(s).toHaveLength(g3.lastMonth - g3.firstMonth + 1);
    expect(g3.annual.map((r) => r.year)).toEqual(Array.from({ length: 15 }, (_, i) => 2026 + i));
  });

  it('survivor is always 0 and deathMonths are all null', () => {
    expect(g3.deathMonths).toEqual([null, null]);
    for (const s of g3.series) for (const mo of s) expect(mo.survivor).toBe(0);
    for (const row of g3.annual) for (const p of row.perPerson) expect(p.survivor).toBe(0);
  });

  it('annual = sum of the 12 series months; household = sum of person totals', () => {
    for (const row of g3.annual) {
      const first = mi(row.year, 1) - g3.firstMonth;
      row.perPerson.forEach((p, i) => {
        const months = g3.series[i].slice(first, first + 12);
        expect(p.own).toBeCloseTo(months.reduce((s, x) => s + x.own, 0), 8);
        expect(p.spousal).toBeCloseTo(months.reduce((s, x) => s + x.spousal, 0), 8);
        expect(p.total).toBeCloseTo(p.own + p.spousal + p.survivor, 8);
      });
      expect(row.household).toBeCloseTo(
        row.perPerson.reduce((s, p) => s + p.total, 0),
        8,
      );
    }
    expect(g3.annual[0].household).toBe(0); // 2026: nobody has claimed yet
  });

  it('reports own and spousal starts inside the window', () => {
    expect(g3.starts).toEqual([
      { personIndex: 0, kind: 'own', month: mi(2031, 7) },
      { personIndex: 1, kind: 'own', month: mi(2032, 6) },
      { personIndex: 0, kind: 'spousal', month: mi(2032, 6) },
    ]);
  });

  it('a single person has own only', () => {
    const r = computeOwnAndSpousal({
      asOf,
      colaRate: 0,
      growthRate: null,
      people: [piaPerson(1970, 6, 2000)],
      claimMonth: [mi(2037, 6)],
      endYear: 2040,
    });
    expect(r.series).toHaveLength(1);
    expect(at(r, 0, mi(2037, 5)).own).toBe(0);
    expect(at(r, 0, mi(2037, 6)).own).toBe(2000);
    expect(r.series[0].every((x) => x.spousal === 0)).toBe(true);
    expect(r.starts).toEqual([{ personIndex: 0, kind: 'own', month: mi(2037, 6) }]);
  });
});

describe('computeOwnAndSpousal: G3 (Sally 1,200 / Jeff 3,500, 1.5% COLA)', () => {
  let r: SsResult;
  beforeAll(() => {
    r = computeOwnAndSpousal(goldenInputs('G3'));
  });

  it("Sally's June 2032 add-on is 550 x 0.70 x 1.015^6 = 420.9757 (shown as 421, not 393)", () => {
    const spousal = at(r, 0, mi(2032, 6)).spousal;
    expect(spousal).toBeCloseTo(550 * 0.7 * 1.015 ** 6, 6);
    expect(spousal).toBeCloseTo(420.9757, 4);
    expect(Math.round(spousal)).toBe(421);
    expect(spousal).not.toBeCloseTo(393, 0);
  });

  it('every golden check for the spousal/own components holds', () => {
    for (const c of GOLDEN_FIXTURES.G3.expected.checks) {
      if ('total' in c || c.component === 'household' || c.component === 'survivor') continue;
      expect(at(r, c.personIndex, c.month)[c.component]).toBeCloseTo(c.amount, 2);
    }
  });

  it("spousal starts at Jeff's filing month, not at Sally's own claim month", () => {
    expect(at(r, 0, mi(2032, 5)).spousal).toBe(0);
    expect(at(r, 0, mi(2031, 7)).spousal).toBe(0);
    expect(at(r, 0, mi(2031, 7)).own).toBeCloseTo(845 * 1.015 ** 5, 6); // 70.4167% of 1,200
  });

  it('COLA steps each January on the spousal part', () => {
    expect(at(r, 0, mi(2032, 12)).spousal).toBeCloseTo(385 * 1.015 ** 6, 6);
    expect(at(r, 0, mi(2033, 1)).spousal).toBeCloseTo(385 * 1.015 ** 7, 6);
  });

  it('the higher earner gets no spousal top-up', () => {
    expect(r.series[1].every((x) => x.spousal === 0)).toBe(true);
    expect(at(r, 1, mi(2032, 6)).own).toBeCloseTo(3500 * 1.015 ** 6, 6);
  });
});

describe('computeOwnAndSpousal: E6 and E22 through the engine', () => {
  // Lower: born June 1965, FRA 67 = June 2032, PIA 1,000. Higher: born June 1960, PIA 2,800.
  const lower = piaPerson(1965, 6, 1000);
  const higher = piaPerson(1960, 6, 2800);

  it('E6: lower files at 62y1m, higher at 70y0m (lower 65y0m) -> spousal $333.33, own 704.17 + 333.33', () => {
    const r = computeOwnAndSpousal(couple(lower, higher, mi(2027, 7), mi(2030, 6)));
    expect(at(r, 0, mi(2030, 5)).spousal).toBe(0);
    expect(at(r, 0, mi(2030, 6)).spousal).toBeCloseTo(333.33, 2);
    expect(at(r, 0, mi(2030, 6)).own).toBeCloseTo(704.1667, 4);
    expect(at(r, 1, mi(2030, 6)).own).toBeCloseTo(3472, 6);
  });

  it('E22: both file at the first legal month -> own 70.4167%, spousal 65.4167% of the $400 top-up', () => {
    const r = computeOwnAndSpousal(couple(lower, higher, mi(2027, 7), mi(2027, 7)));
    expect(at(r, 0, mi(2027, 7)).own / 1000).toBeCloseTo(0.704167, 6);
    expect(at(r, 0, mi(2027, 7)).spousal / 400).toBeCloseTo(0.654167, 6);
  });

  it('spousal is measured from the later filing month back to own FRA (later claimant)', () => {
    // Higher files first (July 2027); lower files July 2030 (24 months early): start = lower's own claim.
    const r = computeOwnAndSpousal(couple(lower, higher, mi(2030, 7), mi(2027, 7)));
    expect(at(r, 0, mi(2030, 6)).spousal).toBe(0);
    expect(at(r, 0, mi(2030, 7)).spousal).toBeCloseTo(400 * (1 - (23 * 25) / 36 / 100), 6);
  });

  it('delaying the own claim past FRA adds nothing to the spousal part', () => {
    const atFra = computeOwnAndSpousal(couple(lower, higher, mi(2032, 6), mi(2027, 7)));
    const delayed = computeOwnAndSpousal(couple(lower, higher, mi(2035, 6), mi(2027, 7)));
    expect(at(atFra, 0, mi(2036, 1)).spousal).toBeCloseTo(400, 8);
    expect(at(delayed, 0, mi(2036, 1)).spousal).toBeCloseTo(400, 8);
    expect(at(delayed, 0, mi(2036, 1)).own).toBeGreaterThan(at(atFra, 0, mi(2036, 1)).own);
  });

  it('own part keeps the January rule in the spousal path (E9: born March 1960, PIA 2,000)', () => {
    const r = computeOwnAndSpousal({
      asOf,
      colaRate: 0,
      growthRate: null,
      people: [piaPerson(1960, 3, 2000)],
      claimMonth: [mi(2028, 3)],
      endYear: 2030,
    });
    expect(at(r, 0, mi(2028, 3)).own).toBeCloseTo(2120, 6);
    expect(at(r, 0, mi(2028, 12)).own).toBeCloseTo(2120, 6);
    expect(at(r, 0, mi(2029, 1)).own).toBeCloseTo(2160, 6);
  });

  it('COLA multiplies once per January from asOf.year (E8: 2,000 at FRA Jan 2030 -> 2,207.63)', () => {
    const r = computeOwnAndSpousal({
      asOf,
      colaRate: 0.025,
      growthRate: null,
      people: [piaPerson(1963, 1, 2000)],
      claimMonth: [mi(2030, 1)],
      endYear: 2031,
    });
    expect(at(r, 0, mi(2030, 1)).own).toBeCloseTo(2207.63, 2);
  });
});

describe('computeOwnAndSpousal: no-benefit and zero-PIA spouses', () => {
  it('a $0-PIA person receives only the spousal top-up (50% of the other PIA, reduced)', () => {
    const zero = piaPerson(1965, 6, 0);
    const high = piaPerson(1965, 6, 2000);
    const r = computeOwnAndSpousal(couple(zero, high, mi(2032, 6), mi(2032, 6)));
    expect(at(r, 0, mi(2032, 6)).own).toBe(0);
    expect(at(r, 0, mi(2032, 6)).spousal).toBe(1000);
    expect(at(r, 1, mi(2032, 6)).spousal).toBe(0);
  });

  it('a $0-PIA spouse gives the other person no spousal top-up (no negative amounts), and takes spousal itself', () => {
    const r = computeOwnAndSpousal(couple(piaPerson(1965, 6, 1000), piaPerson(1965, 6, 0), mi(2032, 6), mi(2032, 6)));
    expect(r.series[0].every((x) => x.spousal === 0)).toBe(true);
    expect(r.series[1].every((x) => x.own === 0)).toBe(true);
    expect(at(r, 1, mi(2032, 6)).spousal).toBe(500);
    expect(r.starts.filter((s) => s.kind === 'spousal')).toEqual([{ personIndex: 1, kind: 'spousal', month: mi(2032, 6) }]);
  });

  it('both $0 is all zeros', () => {
    const r = computeOwnAndSpousal(couple(piaPerson(1965, 6, 0), piaPerson(1965, 6, 0), mi(2032, 6), mi(2032, 6)));
    expect(r.annual.every((row) => row.household === 0)).toBe(true);
  });

  it('no spousal when own PIA already exceeds half the other (both PIAs entered)', () => {
    const r = computeOwnAndSpousal(couple(piaPerson(1965, 6, 1500), piaPerson(1965, 6, 2800), mi(2032, 6), mi(2032, 6)));
    expect(r.series[0].every((x) => x.spousal === 0)).toBe(true);
  });
});

describe('computeOwnAndSpousal: collecting person (ERD 12.19.8, E28)', () => {
  it('A collecting since a prior year, B (higher PIA) claims in 8 months: spousal begins at B claim month', () => {
    // A born March 1960, since April 2022 (62y1m), check = 1,000 PIA x 70.4167%. FRA March 2027.
    const a = collecting(1960, 3, (1000 * 845) / 1200, mi(2022, 4));
    const b = piaPerson(1962, 6, 2800);
    const r = computeOwnAndSpousal(couple(a, b, null, mi(2027, 5)));
    expect(at(r, 0, mi(2026, 9)).own).toBeCloseTo((1000 * 845) / 1200, 6);
    expect(at(r, 0, mi(2027, 4)).spousal).toBe(0);
    expect(at(r, 0, mi(2027, 5)).spousal).toBeCloseTo(400, 6); // past A's FRA: no reduction
    expect(r.starts).toContainEqual({ personIndex: 0, kind: 'spousal', month: mi(2027, 5) });
    expect(r.series[0].slice(0, mi(2027, 5) - r.firstMonth).every((x) => x.spousal === 0)).toBe(true);
  });

  it('mirrored: the spouse is the collecting one; spousal for A starts at A own claim (the later month)', () => {
    const a = piaPerson(1962, 6, 1000); // FRA June 2029
    const b = collecting(1960, 6, 2800 * (845 / 1200), mi(2022, 7)); // PIA 2,800
    const r = computeOwnAndSpousal(couple(a, b, mi(2027, 5), null));
    expect(at(r, 0, mi(2027, 4)).spousal).toBe(0);
    expect(at(r, 0, mi(2027, 5)).spousal).toBeCloseTo(400 * (1 - (25 * 25) / 36 / 100), 6);
    expect(at(r, 1, mi(2026, 9)).own).toBeCloseTo(2800 * (845 / 1200), 6);
    expect(r.series[1].every((x) => x.spousal === 0)).toBe(true);
  });

  it.each(['E28a', 'E28b', 'E28c'] as const)('%s: own series matches the golden checks; no spousal', (key) => {
    const r = computeOwnAndSpousal(goldenInputs(key));
    for (const c of GOLDEN_FIXTURES[key].expected.checks) {
      if ('total' in c || c.component !== 'own') continue;
      expect(at(r, c.personIndex, c.month).own).toBeCloseTo(c.amount, 2);
    }
    expect(r.series[0].every((x) => x.spousal === 0)).toBe(true);
  });

  it.each([
    ['G11a', 24000],
    ['G11b', 18000],
  ] as const)('%s: year-0 annual is the full calendar year of payable months', (key, expected) => {
    const r = computeOwnAndSpousal(goldenInputs(key));
    expect(r.annual[0].year).toBe(2026);
    expect(r.annual[0].household).toBeCloseTo(expected, 6);
  });

  it('a collecting person who started this asOf year pays the January-rule factor, then steps', () => {
    const r = computeOwnAndSpousal(goldenInputs('E28c'));
    expect(at(r, 0, mi(2026, 3)).own).toBeCloseTo(2360, 6);
    expect(at(r, 0, mi(2026, 2)).own).toBe(0);
    expect(at(r, 0, mi(2027, 1)).own).toBeCloseTo(2460, 6);
    expect(r.starts).toEqual([{ personIndex: 0, kind: 'own', month: mi(2026, 3) }]);
  });

  it('a collecting person whose start predates the window has no start event', () => {
    const r = computeOwnAndSpousal(goldenInputs('E28a'));
    expect(r.starts).toEqual([]);
  });
});

describe('computeOwnAndSpousal: validation (typed errors)', () => {
  const base = (): Inputs => couple(piaPerson(1965, 6, 1000), piaPerson(1960, 6, 2800), mi(2030, 7), mi(2030, 6));
  const with_ = (patch: Partial<Inputs>): Inputs => ({ ...base(), ...patch });
  const code = (i: Inputs) => codeOf(() => computeOwnAndSpousal(i));

  it('accepts the baseline', () => {
    expect(code(base())).toBeUndefined();
  });

  it('SS_INVALID_AS_OF', () => {
    expect(code(with_({ asOf: { year: 2026, month: 13 } }))).toBe('SS_INVALID_AS_OF');
    expect(code(with_({ asOf: { year: 2026.5, month: 3 } }))).toBe('SS_INVALID_AS_OF');
  });

  it('endYear before asOf.year or fractional is SS_INVALID_AS_OF; non-finite is NON_FINITE_INPUT', () => {
    expect(code(with_({ endYear: 2025 }))).toBe('SS_INVALID_AS_OF');
    expect(code(with_({ endYear: 2040.5 }))).toBe('SS_INVALID_AS_OF');
    expect(code(with_({ endYear: Number.NaN }))).toBe('NON_FINITE_INPUT');
  });

  it('SS_INVALID_COLA / SS_INVALID_GROWTH_RATE / NON_FINITE_INPUT', () => {
    expect(code(with_({ colaRate: -0.01 }))).toBe('SS_INVALID_COLA');
    expect(code(with_({ colaRate: 0.2001 }))).toBe('SS_INVALID_COLA');
    expect(code(with_({ colaRate: 0.2 }))).toBeUndefined();
    expect(code(with_({ colaRate: Number.NaN }))).toBe('NON_FINITE_INPUT');
    expect(code(with_({ growthRate: 0.26 }))).toBe('SS_INVALID_GROWTH_RATE');
    expect(code(with_({ growthRate: -0.01 }))).toBe('SS_INVALID_GROWTH_RATE');
    expect(code(with_({ growthRate: 0 }))).toBeUndefined();
    expect(code(with_({ growthRate: Number.NaN }))).toBe('NON_FINITE_INPUT');
  });

  it('SS_NEGATIVE_BENEFIT for a negative PIA or check; NON_FINITE_INPUT for NaN PIA', () => {
    expect(code(with_({ people: [piaPerson(1965, 6, -1), piaPerson(1960, 6, 2800)] }))).toBe('SS_NEGATIVE_BENEFIT');
    expect(code(with_({ people: [piaPerson(1965, 6, Number.NaN), piaPerson(1960, 6, 2800)] }))).toBe('NON_FINITE_INPUT');
    expect(
      code(
        with_({
          people: [collecting(1960, 3, -5, mi(2022, 4)), piaPerson(1960, 6, 2800)],
          claimMonth: [null, mi(2030, 6)],
        }),
      ),
    ).toBe('SS_NEGATIVE_BENEFIT');
  });

  it('SS_INVALID_BIRTH / SS_UNSUPPORTED_BIRTH_YEAR', () => {
    expect(code(with_({ people: [piaPerson(1965, 13, 1000), piaPerson(1960, 6, 2800)] }))).toBe('SS_INVALID_BIRTH');
    expect(code(with_({ people: [piaPerson(1942, 6, 1000), piaPerson(1960, 6, 2800)] }))).toBe(
      'SS_UNSUPPORTED_BIRTH_YEAR',
    );
  });

  it('SS_CLAIM_BEFORE_ELIGIBLE / SS_CLAIM_AFTER_70 / SS_CLAIM_IN_PAST', () => {
    expect(code(with_({ claimMonth: [mi(1965 + 62, 6), mi(2030, 6)] }))).toBe('SS_CLAIM_BEFORE_ELIGIBLE'); // 62y0m
    expect(code(with_({ claimMonth: [mi(2035, 7), mi(2030, 6)] }))).toBe('SS_CLAIM_AFTER_70'); // 1965-06 + 70y1m
    expect(code(with_({ claimMonth: [mi(2035, 6), mi(2030, 6)] }))).toBeUndefined(); // exactly 70y0m is legal
    expect(code(with_({ claimMonth: [mi(2030, 7), mi(2026, 9)] }))).toBe('SS_CLAIM_IN_PAST'); // at the asOf month
    expect(code(with_({ claimMonth: [mi(2030, 7), mi(2026, 10)] }))).toBeUndefined(); // the month after is legal
  });

  it('SS_CLAIM_AFTER_70 when the legal window is empty (already past 70, not collecting)', () => {
    expect(code(with_({ people: [piaPerson(1955, 6, 1000), piaPerson(1960, 6, 2800)], claimMonth: [mi(2027, 1), mi(2030, 6)] }))).toBe(
      'SS_CLAIM_AFTER_70',
    );
  });

  it('SS_INVALID_ALREADY_COLLECTING for claimMonth/benefit.kind mismatch and a bad sinceMonth', () => {
    const coll = collecting(1960, 3, 700, mi(2022, 4));
    expect(code(with_({ people: [coll, piaPerson(1960, 6, 2800)], claimMonth: [mi(2027, 1), mi(2030, 6)] }))).toBe(
      'SS_INVALID_ALREADY_COLLECTING',
    );
    expect(code(with_({ claimMonth: [null, mi(2030, 6)] }))).toBe('SS_INVALID_ALREADY_COLLECTING');
    expect(code(with_({ claimMonth: [mi(2030, 7)] }))).toBe('SS_INVALID_ALREADY_COLLECTING'); // missing entry
    const early = collecting(1960, 3, 700, mi(2021, 1)); // before 62y1m
    expect(code(with_({ people: [early, piaPerson(1960, 6, 2800)], claimMonth: [null, mi(2030, 6)] }))).toBe(
      'SS_INVALID_ALREADY_COLLECTING',
    );
    const future = collecting(1960, 3, 700, mi(2027, 1)); // after asOf
    expect(code(with_({ people: [future, piaPerson(1960, 6, 2800)], claimMonth: [null, mi(2030, 6)] }))).toBe(
      'SS_INVALID_ALREADY_COLLECTING',
    );
  });

  it('SS_SPOUSAL_INPUT_ON_SINGLE for a second claimMonth on a one-person household', () => {
    expect(
      code({
        asOf,
        colaRate: 0,
        growthRate: null,
        people: [piaPerson(1965, 6, 1000)],
        claimMonth: [mi(2030, 7), mi(2030, 6)],
        endYear: 2040,
      }),
    ).toBe('SS_SPOUSAL_INPUT_ON_SINGLE');
  });

  it('never returns partial results: an invalid second person throws', () => {
    expect(code(with_({ people: [piaPerson(1965, 6, 1000), piaPerson(1960, 6, -3)] }))).toBe('SS_NEGATIVE_BENEFIT');
  });
});

describe('computeOwnAndSpousal: review gap closers', () => {
  const lower = piaPerson(1965, 6, 1000); // born June 1965
  const higher = piaPerson(1960, 6, 2800);
  const single = (claim: number, endYear: number): Inputs => ({
    asOf,
    colaRate: 0,
    growthRate: null,
    people: [lower],
    claimMonth: [claim],
    endYear,
  });
  const code = (i: Inputs) => codeOf(() => computeOwnAndSpousal(i));
  const kindsOf = (r: SsResult, kind: SsStartKind) => r.starts.filter((s) => s.kind === kind);

  it('a NaN claimMonth is NON_FINITE_INPUT', () => {
    expect(code(couple(lower, higher, Number.NaN, mi(2030, 6)))).toBe('NON_FINITE_INPUT');
    // A single person has no spousal path to catch it downstream, so the claimMonth check itself must.
    expect(code(single(Number.NaN, 2030))).toBe('NON_FINITE_INPUT');
  });

  it('a December claim pays from that December (own factor applies in the claim month)', () => {
    const r = computeOwnAndSpousal(single(mi(2030, 12), 2031));
    expect(at(r, 0, mi(2030, 11)).own).toBe(0);
    expect(at(r, 0, mi(2030, 12)).own).toBeGreaterThan(0);
    expect(r.annual.find((row) => row.year === 2030)?.perPerson[0].own).toBeGreaterThan(0);
  });

  describe('starts window boundaries are inclusive', () => {
    // Born Dec 1963: 62y1m = Jan 2026 (first month of the window). Born Nov 1963: Dec 2025 (just outside).
    const collectingB = collecting(1960, 6, (2800 * 845) / 1200, mi(2022, 7)); // PIA 2,800, started long ago
    const alone = (p: SsPerson): Inputs => ({ ...single(0, 2027), people: [p], claimMonth: [null] });

    it('own start exactly in January of asOf.year is listed; December before is not', () => {
      expect(computeOwnAndSpousal(alone(collecting(1963, 12, 1000, mi(2026, 1)))).starts).toEqual([
        { personIndex: 0, kind: 'own', month: mi(2026, 1) },
      ]);
      expect(computeOwnAndSpousal(alone(collecting(1963, 11, 1000, mi(2025, 12)))).starts).toEqual([]);
    });

    it('spousal start exactly in January of asOf.year is listed; December before is not', () => {
      const inJan = computeOwnAndSpousal(couple(collecting(1963, 12, 0, mi(2026, 1)), collectingB, null, null, 2030));
      expect(inJan.starts).toEqual([
        { personIndex: 0, kind: 'own', month: mi(2026, 1) },
        { personIndex: 0, kind: 'spousal', month: mi(2026, 1) },
      ]);
      const beforeJan = computeOwnAndSpousal(couple(collecting(1963, 11, 0, mi(2025, 12)), collectingB, null, null, 2030));
      expect(beforeJan.starts).toEqual([]);
      expect(at(beforeJan, 0, mi(2026, 1)).spousal).toBeGreaterThan(0); // still paid, just no event
    });

    it('own start exactly in December of endYear is listed; January after is not', () => {
      expect(computeOwnAndSpousal(single(mi(2030, 12), 2030)).starts).toEqual([
        { personIndex: 0, kind: 'own', month: mi(2030, 12) },
      ]);
      expect(computeOwnAndSpousal(single(mi(2031, 1), 2030)).starts).toEqual([]);
    });

    it('spousal start exactly in December of endYear is listed; January after is not', () => {
      const inDec = computeOwnAndSpousal(couple(lower, higher, mi(2030, 12), mi(2029, 6), 2030));
      expect(kindsOf(inDec, 'spousal')).toEqual([{ personIndex: 0, kind: 'spousal', month: mi(2030, 12) }]);
      const afterDec = computeOwnAndSpousal(couple(lower, higher, mi(2031, 1), mi(2029, 6), 2030));
      expect(kindsOf(afterDec, 'spousal')).toEqual([]);
    });
  });

  it('starts sort by month first: an earlier own start of person 1 precedes person 0 own and spousal', () => {
    const r = computeOwnAndSpousal(couple(lower, higher, mi(2030, 7), mi(2029, 6)));
    expect(r.starts).toEqual([
      { personIndex: 1, kind: 'own', month: mi(2029, 6) },
      { personIndex: 0, kind: 'own', month: mi(2030, 7) },
      { personIndex: 0, kind: 'spousal', month: mi(2030, 7) },
    ]);
  });

  it('starts in the same month and kind sort by person index', () => {
    const r = computeOwnAndSpousal(couple(lower, higher, mi(2030, 6), mi(2030, 6)));
    expect(r.starts).toEqual([
      { personIndex: 0, kind: 'own', month: mi(2030, 6) },
      { personIndex: 1, kind: 'own', month: mi(2030, 6) },
      { personIndex: 0, kind: 'spousal', month: mi(2030, 6) },
    ]);
  });

  it('growthRate 0.25 is accepted and just over is rejected', () => {
    expect(code({ ...couple(lower, higher, mi(2030, 7), mi(2030, 6)), growthRate: 0.25 })).toBeUndefined();
    expect(code({ ...couple(lower, higher, mi(2030, 7), mi(2030, 6)), growthRate: 0.2501 })).toBe(
      'SS_INVALID_GROWTH_RATE',
    );
  });

  it('0 or 3 people is SS_SPOUSAL_INPUT_ON_SINGLE (current behavior: no dedicated code)', () => {
    const none = { asOf, colaRate: 0, growthRate: null, people: [], claimMonth: [], endYear: 2030 } as unknown as Inputs;
    expect(code(none)).toBe('SS_SPOUSAL_INPUT_ON_SINGLE');
    const three = {
      asOf,
      colaRate: 0,
      growthRate: null,
      people: [lower, higher, lower],
      claimMonth: [mi(2030, 7), mi(2030, 6), mi(2030, 7)],
      endYear: 2030,
    } as unknown as Inputs;
    expect(code(three)).toBe('SS_SPOUSAL_INPUT_ON_SINGLE');
  });

  it('a collecting person with an undefined or missing claimMonth entry is accepted', () => {
    const coll = collecting(1960, 3, 700, mi(2022, 4));
    expect(code({ ...single(0, 2030), people: [coll], claimMonth: [undefined as unknown as null] })).toBeUndefined();
    expect(code({ ...single(0, 2030), people: [coll], claimMonth: [] })).toBeUndefined();
  });

  it('PINNED (under review): a $0-PIA person still gets an own starts entry', () => {
    const r = computeOwnAndSpousal(couple(piaPerson(1965, 6, 0), piaPerson(1965, 6, 2000), mi(2032, 6), mi(2032, 6)));
    expect(r.starts).toContainEqual({ personIndex: 0, kind: 'own', month: mi(2032, 6) });
  });
});
