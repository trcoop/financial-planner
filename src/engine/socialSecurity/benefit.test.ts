import { describe, expect, it } from 'vitest';

import { InvalidProjectionInputError } from '../errors';
import type { ProjectionErrorCode } from '../errors';
import { collectingPia, fraMonths, legalClaimWindow, ownFactorAt, ownFactorSteady, survivorFraMonths } from './benefit';
import { GOLDEN_FIXTURES } from './goldenFixtures';
import type { GoldenCheck } from './goldenFixtures';
import { ssTablesFixture } from './ssTables.fixture';
import type { SsPerson } from './types';

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

const piaPerson = (birthYear: number, birthMonth: number, pia = 2000): SsPerson => ({
  birthYear,
  birthMonth,
  benefit: { kind: 'pia', pia },
});

const collecting = (y: number, m: number, check: number, since: number): SsPerson => ({
  birthYear: y,
  birthMonth: m,
  benefit: { kind: 'collecting', check, sinceMonth: since },
});

describe('fraMonths (ERD section 4)', () => {
  it('matches the FRA table', () => {
    expect([1943, 1954, 1955, 1956, 1957, 1958, 1959, 1960, 1961, 1999].map(fraMonths)).toEqual([
      792, 792, 794, 796, 798, 800, 802, 804, 804, 804,
    ]);
  });
  it('rejects births before 1943 and malformed input', () => {
    expect(codeOf(() => fraMonths(1942))).toBe('SS_UNSUPPORTED_BIRTH_YEAR');
    expect(codeOf(() => fraMonths(1960.5))).toBe('SS_INVALID_BIRTH');
    expect(codeOf(() => fraMonths(Number.NaN))).toBe('NON_FINITE_INPUT');
  });
});

describe('survivorFraMonths = fraMonths(Y - 2) (ERD 12.5)', () => {
  it('covers the 9 cohorts', () => {
    expect([1943, 1944, 1945, 1953, 1957, 1958, 1959, 1960, 1961, 1962, 2001].map(survivorFraMonths)).toEqual([
      788, 790, 792, 792, 794, 796, 798, 800, 802, 804, 804,
    ]);
  });
  it('rejects births before 1943', () => {
    expect(codeOf(() => survivorFraMonths(1942))).toBe('SS_UNSUPPORTED_BIRTH_YEAR');
  });
});

describe('ownFactorSteady', () => {
  it('G1 factor: FRA 67, 62y1m = 70.4167%', () => {
    expect(ownFactorSteady(804, 745)).toBeCloseTo(0.704167, 6);
  });
  it('checkpoints from the ERD cohort table', () => {
    const pct = (f: number, c: number) => ownFactorSteady(f, c) * 100;
    expect(pct(792, 745)).toBeCloseTo(75.4167, 4);
    expect(pct(792, 840)).toBeCloseTo(132, 6);
    expect(pct(794, 745)).toBeCloseTo(74.5833, 4);
    expect(pct(798, 840)).toBeCloseTo(128, 6);
    expect(pct(804, 840)).toBeCloseTo(124, 6);
    expect(pct(804, 804)).toBe(100);
    expect(pct(804, 839)).toBeCloseTo(123.3333, 4);
    expect(pct(804, 792)).toBeCloseTo(93.3333, 4);
  });
  it('is strictly increasing in claim month for every cohort', () => {
    for (const f of [792, 794, 796, 798, 800, 802, 804]) {
      for (let c = 746; c <= 840; c++) expect(ownFactorSteady(f, c)).toBeGreaterThan(ownFactorSteady(f, c - 1));
    }
  });
  it('rejects claim ages outside 745..840 and non-finite input', () => {
    expect(codeOf(() => ownFactorSteady(804, 744))).toBe('SS_CLAIM_BEFORE_ELIGIBLE');
    expect(codeOf(() => ownFactorSteady(804, 841))).toBe('SS_CLAIM_AFTER_70');
    expect(codeOf(() => ownFactorSteady(804, Number.NaN))).toBe('NON_FINITE_INPUT');
  });
});

describe('ownFactorAt (January rule, PRD E9)', () => {
  const march1960 = piaPerson(1960, 3);
  it('is 0 before the claim month', () => {
    expect(ownFactorAt(march1960, mi(2028, 3), mi(2028, 2))).toBe(0);
  });
  it('E9 fixture 1: born Mar 1960, claim Mar 2028 -> $2,120 through Dec 2028, $2,160 from Jan 2029', () => {
    const claim = mi(2028, 3);
    expect(2000 * ownFactorAt(march1960, claim, claim)).toBeCloseTo(2120, 6);
    expect(2000 * ownFactorAt(march1960, claim, mi(2028, 12))).toBeCloseTo(2120, 6);
    expect(2000 * ownFactorAt(march1960, claim, mi(2029, 1))).toBeCloseTo(2160, 6);
  });
  it('E9 fixture 2: born Dec 1960, claim Dec 2028 -> $2,000 then $2,160 from Jan 2029', () => {
    const p = piaPerson(1960, 12);
    const claim = mi(2028, 12);
    expect(2000 * ownFactorAt(p, claim, claim)).toBeCloseTo(2000, 6);
    expect(2000 * ownFactorAt(p, claim, mi(2029, 1))).toBeCloseTo(2160, 6);
  });
  it('E9 fixture 3: born Mar 1960, claim Sep 2029 -> 114% then 120% from Jan 2030', () => {
    const claim = mi(2029, 9);
    expect(ownFactorAt(march1960, claim, claim)).toBeCloseTo(1.14, 9);
    expect(ownFactorAt(march1960, claim, mi(2030, 1))).toBeCloseTo(1.2, 9);
  });
  it('claim at exactly 70y0m applies all credits immediately', () => {
    const claim = mi(2030, 3);
    expect(ownFactorAt(march1960, claim, claim)).toBeCloseTo(1.24, 9);
  });
  it('claim at or before FRA is constant', () => {
    const claim = mi(2025, 3);
    expect(ownFactorAt(march1960, claim, claim)).toBe(ownFactorAt(march1960, claim, mi(2040, 1)));
  });
  it('rejects claims outside the legal age range', () => {
    expect(codeOf(() => ownFactorAt(march1960, mi(2022, 3), mi(2022, 3)))).toBe('SS_CLAIM_BEFORE_ELIGIBLE');
    expect(codeOf(() => ownFactorAt(march1960, mi(2030, 4), mi(2030, 4)))).toBe('SS_CLAIM_AFTER_70');
  });
});

describe('legalClaimWindow', () => {
  it('not collecting: 62y1m..70y0m, clamped to the month after asOf', () => {
    expect(legalClaimWindow(piaPerson(1970, 6), asOf)).toEqual({ earliest: mi(2032, 7), latest: mi(2040, 6) });
    expect(legalClaimWindow(piaPerson(1962, 3), asOf)).toEqual({ earliest: mi(2026, 10), latest: mi(2032, 3) });
  });
  it('null when already past 70', () => {
    expect(legalClaimWindow(piaPerson(1955, 3), asOf)).toBeNull();
  });
  it('a latest month at or before the asOf month is an empty window (claim must be after asOf)', () => {
    expect(legalClaimWindow(piaPerson(1956, 9), asOf)).toBeNull();
    expect(legalClaimWindow(piaPerson(1956, 10), asOf)).toEqual({ earliest: mi(2026, 10), latest: mi(2026, 10) });
  });
  it('validates birth', () => {
    expect(codeOf(() => legalClaimWindow(piaPerson(1960, 13), asOf))).toBe('SS_INVALID_BIRTH');
    expect(codeOf(() => legalClaimWindow(piaPerson(1900, 1), asOf))).toBe('SS_UNSUPPORTED_BIRTH_YEAR');
  });
  it('collecting person: 62y1m..min(70y0m, asOf month)', () => {
    expect(legalClaimWindow(collecting(1960, 3, 1, mi(2022, 4)), asOf)).toEqual({
      earliest: mi(2022, 4),
      latest: mi(2026, 9),
    });
  });
});

describe('collectingPia (already-collecting inverse, PRD E7)', () => {
  it('born Mar 1960, 62y1m start, check 2,112.50 -> PIA 3,000', () => {
    expect(collectingPia(collecting(1960, 3, 2112.5, mi(2022, 4)), asOf)).toBeCloseTo(3000, 6);
  });
  it('start Mar 2028 at 68y0m: asOf Sep 2028 factor 106%; Sep 2029 factor 108%', () => {
    expect(collectingPia(collecting(1960, 3, 3180, mi(2028, 3)), { year: 2028, month: 9 })).toBeCloseTo(3000, 6);
    expect(collectingPia(collecting(1960, 3, 3240, mi(2028, 3)), { year: 2029, month: 9 })).toBeCloseTo(3000, 6);
  });
  it('$0 check is valid (PIA 0)', () => {
    expect(collectingPia(collecting(1960, 3, 0, mi(2022, 4)), asOf)).toBe(0);
  });
  it('typed errors', () => {
    expect(codeOf(() => collectingPia(collecting(1960, 3, -1, mi(2022, 4)), asOf))).toBe('SS_NEGATIVE_BENEFIT');
    expect(codeOf(() => collectingPia(collecting(1960, 3, Number.NaN, mi(2022, 4)), asOf))).toBe('NON_FINITE_INPUT');
    // before 62y1m, after 70y0m, after asOf, and a pia-kind person:
    expect(codeOf(() => collectingPia(collecting(1960, 3, 1, mi(2022, 3)), asOf))).toBe('SS_INVALID_ALREADY_COLLECTING');
    expect(codeOf(() => collectingPia(collecting(1950, 3, 1, mi(2020, 4)), asOf))).toBe('SS_INVALID_ALREADY_COLLECTING');
    expect(codeOf(() => collectingPia(collecting(1960, 3, 1, mi(2026, 10)), asOf))).toBe(
      'SS_INVALID_ALREADY_COLLECTING',
    );
    expect(codeOf(() => collectingPia(piaPerson(1960, 3), asOf))).toBe('SS_INVALID_ALREADY_COLLECTING');
  });
});

describe('goldens recorded from goldenFixtures', () => {
  it('G1: PIA 2,300, FRA 67, claim 62y1m (July 2032) = 1,619.5833', () => {
    const fx = GOLDEN_FIXTURES.G1;
    const [p] = fx.inputs.people;
    const pia = p.benefit.kind === 'pia' ? p.benefit.pia : -1;
    const claim = fx.inputs.claimMonth[0] as number;
    const check = fx.expected.checks[0] as Extract<GoldenCheck, { personIndex: number }>;
    expect(pia).toBe(2300);
    expect(claim).toBe(mi(2032, 7));
    expect(check.month).toBe(claim);
    expect(pia * ownFactorAt(p, claim, check.month)).toBeCloseTo(check.amount, 2);
    expect(check.amount).toBeCloseTo(1619.58, 2);
  });

  it.each(['E28a', 'E28b', 'E28c'] as const)('%s forward series (14 months, COLA every January)', (key) => {
    const fx = GOLDEN_FIXTURES[key];
    const [p] = fx.inputs.people;
    const since = p.benefit.kind === 'collecting' ? p.benefit.sinceMonth : -1;
    const pia = collectingPia(p, fx.inputs.asOf);
    const amountAt = (m: number) =>
      pia * ownFactorAt(p, since, m) * (1 + fx.inputs.colaRate) ** (Math.floor(m / 12) - fx.inputs.asOf.year);
    const checks = fx.expected.checks.filter((c): c is Extract<GoldenCheck, { month: number }> => 'month' in c);
    expect(checks).toHaveLength(14);
    expect(checks[0]?.month).toBe(mi(2026, 9));
    expect(checks[13]?.month).toBe(mi(2027, 10));
    for (const c of checks) expect(amountAt(c.month)).toBeCloseTo(c.amount, 2);
  });

  it('E28 inverse PIAs: 3,000 / 2,000 / 2,000', () => {
    expect(collectingPia(GOLDEN_FIXTURES.E28a.inputs.people[0], asOf)).toBeCloseTo(3000, 6);
    expect(collectingPia(GOLDEN_FIXTURES.E28b.inputs.people[0], asOf)).toBeCloseTo(2000, 6);
    expect(collectingPia(GOLDEN_FIXTURES.E28c.inputs.people[0], asOf)).toBeCloseTo(2000, 6);
  });

  it('G3 own-side inputs: Sally own at 62y1m = 845 (70.4167%); spousal reduction basis is 48 months (30%)', () => {
    const fx = GOLDEN_FIXTURES.G3;
    const sally = fx.inputs.people[0];
    const jeff = fx.inputs.people[1] as SsPerson;
    expect(sally.benefit).toEqual({ kind: 'pia', pia: 1200 });
    expect(jeff.benefit).toEqual({ kind: 'pia', pia: 3500 });
    expect(fx.inputs.claimMonth).toEqual([mi(2031, 7), mi(2032, 6)]);
    expect(fx.inputs.colaRate).toBe(0.015);
    expect(1200 * ownFactorAt(sally, mi(2031, 7), mi(2031, 7))).toBeCloseTo(845, 6);
    // Jeff files at his FRA (June 2032); Sally's FRA is June 2036: 48 months before it.
    expect(jeff.birthYear * 12 + (jeff.birthMonth - 1) + fraMonths(jeff.birthYear)).toBe(mi(2032, 6));
    expect(sally.birthYear * 12 + (sally.birthMonth - 1) + fraMonths(sally.birthYear) - mi(2032, 6)).toBe(48);
    expect(fx.expected.checks[0]).toMatchObject({ component: 'spousal' });
    // ERD/ticket say "420.97" (shown as 421); the exact value is 420.9757, i.e. 420.98 to the cent.
    const spousal = fx.expected.checks[0] as Extract<GoldenCheck, { personIndex: number }>;
    expect(spousal.amount).toBeCloseTo(420.9757, 4);
    expect(spousal.amount).toBeCloseTo(421, 0);
  });
});

describe('E7/E8/E9 goldens (inputs recorded in this file)', () => {
  // E7 inverse fixtures live in the collectingPia block (2,112.50 -> 3,000; 3,180 -> 3,000; 3,240 -> 3,000);
  // E9 January-rule fixtures live in the ownFactorAt block ($2,120/$2,160/$2,000, 114% -> 120%).
  it('E8: factor-1 claim at FRA times (1.025)^4 = 2,207.63; check 2,112.50 x 1.025^6 = 2,449.85 (COLA applied by callers)', () => {
    // Born Jan 1960 -> FRA Jan 2027; asOf 2026 so the claim sits 1 year after asOf.year and E8's
    // "Jan 2030" example is reproduced by the exponent (2030 - 2026 = 4) on a factor-1 PIA.
    const p = piaPerson(1960, 1);
    const fraClaim = p.birthYear * 12 + (p.birthMonth - 1) + fraMonths(p.birthYear);
    expect(ownFactorAt(p, fraClaim, fraClaim)).toBe(1);
    expect(2000 * 1 * 1.025 ** 4).toBeCloseTo(2207.63, 2);
    expect(2112.5 * 1.025 ** 6).toBeCloseTo(2449.85, 2);
  });
});

describe('P5: person born on the 1st (documented off-by-one)', () => {
  // Born Jan 1 1960. SSA treats a person born on the 1st as born in the previous month (Dec 1959):
  // FRA 66y10m (802) and the first legal month is the 62nd birthday month (Jan 2022). The module stores
  // only month+year and treats everyone as born on the 3rd-31st (PRD P5), so its earliest claim is one
  // month later and its FRA two months later. This fixture records the known divergence.
  const p = piaPerson(1960, 1);
  it('module earliest claim is Feb 2022; SSA would allow Jan 2022', () => {
    const ssaEarliest = mi(2022, 1);
    const earliest = legalClaimWindow(p, { year: 2020, month: 1 })?.earliest;
    expect(earliest).toBe(mi(2022, 2));
    expect((earliest as number) - ssaEarliest).toBe(1);
  });
  it('module FRA is 804 months; SSA (born Dec 1959) is 802', () => {
    expect(fraMonths(1960)).toBe(804);
    expect(fraMonths(1959)).toBe(802);
  });
});

describe('tables generator (ERD 6, 12.5)', () => {
  const { steady, initial } = ssTablesFixture();
  it('emits 7 x 96 steady rows and 7 x 12 x 96 initial rows', () => {
    expect(steady).toHaveLength(672);
    expect(initial).toHaveLength(8064);
  });
  it('code == generator on every steady row', () => {
    for (const r of steady) expect(ownFactorSteady(r.fraMonths, r.claimAge)).toBeCloseTo(r.factor, 12);
  });
  it('code == generator on every initial-factor case; steady from the January after the claim year', () => {
    for (const r of initial) {
      const p = piaPerson(r.birthYear, r.birthMonth);
      const claim = r.birthYear * 12 + (r.birthMonth - 1) + r.claimAge;
      expect(fraMonths(r.birthYear)).toBe(r.fraMonths);
      expect(ownFactorAt(p, claim, claim)).toBeCloseTo(r.factor, 12);
      expect(ownFactorAt(p, claim, (Math.floor(claim / 12) + 1) * 12)).toBeCloseTo(r.steadyFactor, 12);
    }
  });
});
