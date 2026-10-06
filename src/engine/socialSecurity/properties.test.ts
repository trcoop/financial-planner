import { describe, expect, it } from 'vitest';

import { birthMonthIndex } from '../age';
import { fraMonths, legalClaimWindow, ownFactorSteady } from './benefit';
import { evaluateGrid, topClaims } from './evaluate';
import { selectTopClaims } from './topClaimsSelect';
import { computeSocialSecurity } from './household';
import { calculatorHouseholdMonthly, evaluateScenario } from './scenario';
import { survivorBreakdown, survivorStartMonth } from './survivor';
import type { MonthIndex, SsInputs, SsPerson, TopClaimsAxis } from './types';

/**
 * FIN-169 property tests (ERD Round 3). Deterministic: a seeded PRNG drives the random cases, so a
 * failure always reproduces. No network, no clock.
 */
const asOf = { year: 2026, month: 10 };
const mi = (year: number, month: number): MonthIndex => year * 12 + month - 1;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r: () => number, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));

const piaPerson = (birthYear: number, birthMonth: number, pia: number): SsPerson => ({
  birthYear,
  birthMonth,
  benefit: { kind: 'pia', pia },
});

interface Case {
  people: [SsPerson, SsPerson];
  claim: [MonthIndex, MonthIndex];
  deathAge: [number, number];
  cola: number;
}

/** Random couple: both still claimable after asOf, claims inside the legal window. */
function randomCase(r: () => number): Case {
  const people = [0, 1].map(() => piaPerson(pick(r, 1962, 1972), pick(r, 1, 12), pick(r, 0, 4000))) as [SsPerson, SsPerson];
  const claim = people.map((p) => {
    const w = legalClaimWindow(p, asOf)!;
    return pick(r, w.earliest, w.latest);
  }) as [MonthIndex, MonthIndex];
  // Death at least ~1 year after asOf (the engine rejects a death before the asOf month).
  const deathAge = people.map((p) => {
    const currentAge = asOf.year + (asOf.month - 1) / 12 - (p.birthYear + (p.birthMonth - 1) / 12);
    return Math.max(60 + r() * 55, currentAge + 1);
  }) as [number, number];
  return { people, claim, deathAge, cola: r() < 0.5 ? 0 : r() * 0.05 };
}

const inputsOf = (c: Case, over: Partial<SsInputs> = {}): SsInputs => ({
  asOf,
  colaRate: c.cola,
  growthRate: null,
  people: c.people,
  claimMonth: c.claim,
  deathAgeYears: c.deathAge,
  endYear: 2100,
  ...over,
});

const CASES = 150;

describe('property 1: own factor strictly increases with claim month', () => {
  it('for every FRA in the table and every legal claim age', () => {
    for (let fra = 792; fra <= 804; fra += 1) {
      for (let age = 745; age < 840; age++) {
        expect(ownFactorSteady(fra, age + 1), `fra ${fra} age ${age}`).toBeGreaterThan(ownFactorSteady(fra, age));
      }
    }
  });
  it('FRA of each real birth year agrees (1943..1975)', () => {
    for (let y = 1943; y <= 1975; y++) {
      const fra = fraMonths(y);
      expect(ownFactorSteady(fra, fra)).toBe(1);
    }
  });
});

describe('property 2: spousal bound and timing', () => {
  it('spousal <= max(0, 0.5*otherPIA - ownPIA)*(1+cola)^n each month, and 0 before both have filed', () => {
    const r = rng(2);
    for (let k = 0; k < CASES; k++) {
      const c = randomCase(r);
      const res = computeSocialSecurity(inputsOf(c));
      const bothFiled = Math.max(c.claim[0], c.claim[1]);
      for (let i = 0; i < 2; i++) {
        const own = (c.people[i].benefit as { pia: number }).pia;
        const other = (c.people[1 - i].benefit as { pia: number }).pia;
        const excess = Math.max(0, 0.5 * other - own);
        for (let t = res.firstMonth; t <= res.lastMonth; t++) {
          const sp = res.series[i][t - res.firstMonth].spousal;
          const n = Math.floor(t / 12) - asOf.year;
          expect(sp, `case ${k} person ${i} month ${t}`).toBeLessThanOrEqual(excess * (1 + c.cola) ** n + 1e-9);
          if (t < bothFiled) expect(sp, `case ${k} before both filed`).toBe(0);
        }
      }
    }
  });
});

describe('property 3: household check after a death is at least the survivor own benefit', () => {
  it('paid (own + spousal + survivor) >= own benefit with no partner death, for every survivor month', () => {
    const r = rng(3);
    for (let k = 0; k < CASES; k++) {
      const c = randomCase(r);
      const withDeaths = computeSocialSecurity(inputsOf(c));
      for (let i = 0; i < 2; i++) {
        const j = 1 - i;
        // Same inputs but the partner never dies: person i's own benefit alone (survivor/spousal ignored).
        const alone = computeSocialSecurity(inputsOf(c, { deathAgeYears: i === 0 ? [c.deathAge[0], null] : [null, c.deathAge[1]] }));
        const deathJ = withDeaths.deathMonths[j]!;
        for (let t = Math.max(deathJ, withDeaths.firstMonth); t <= withDeaths.lastMonth; t++) {
          const m = withDeaths.series[i][t - withDeaths.firstMonth];
          const ownAlone = alone.series[i][t - alone.firstMonth].own;
          const paid = m.own + m.spousal + m.survivor;
          expect(paid, `case ${k} person ${i} month ${t}`).toBeGreaterThanOrEqual(ownAlone - 1e-9);
        }
      }
    }
  });
});

describe('property 4: survivor amount bounds', () => {
  it('amount <= deceasedBase, <= cap when a cap applies, <= 1.24 * PIA', () => {
    const r = rng(4);
    for (let k = 0; k < 400; k++) {
      const dec = piaPerson(pick(r, 1950, 1972), pick(r, 1, 12), 0);
      const sur = piaPerson(pick(r, 1950, 1975), pick(r, 1, 12), 0);
      const pia = pick(r, 0, 5000);
      const decBirth = birthMonthIndex(dec.birthYear, dec.birthMonth);
      const unclaimed = r() < 0.2;
      const claim = unclaimed ? null : decBirth + pick(r, 745, 840);
      const deathMonth = unclaimed ? decBirth + pick(r, 745, 1300) : Math.max(claim! + pick(r, 0, 400), decBirth + 745);
      const start = survivorStartMonth(deathMonth, sur.birthYear, sur.birthMonth);
      const b = survivorBreakdown({
        deceasedPia: pia,
        deceasedBirthYear: dec.birthYear,
        deceasedBirthMonth: dec.birthMonth,
        deceasedClaimMonth: claim === null ? null : claim,
        deathMonth,
        survivorBirthYear: sur.birthYear,
        survivorBirthMonth: sur.birthMonth,
        survivorStartMonth: start,
      });
      expect(b.amount, `case ${k} <= base`).toBeLessThanOrEqual(b.base + 1e-9);
      if (b.cap !== null) expect(b.amount, `case ${k} <= cap`).toBeLessThanOrEqual(b.cap + 1e-9);
      // 1.24 x PIA is the ceiling for FRA 67 (born 1960+); an earlier FRA earns more credits to 70.
      const ceiling = 1 + (840 - fraMonths(dec.birthYear)) / 150;
      if (dec.birthYear >= 1960) expect(ceiling).toBeCloseTo(1.24, 12);
      expect(b.amount, `case ${k} <= ${ceiling.toFixed(3)} PIA (1.24 for birth >= 1960)`).toBeLessThanOrEqual(ceiling * pia + 1e-9);
      expect(b.amount).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('property 5: every grid cell equals evaluateScenario', () => {
  it('sampled couple grid, with COLA and growth', () => {
    const r = rng(5);
    for (let k = 0; k < 6; k++) {
      const c = randomCase(r);
      const base = {
        asOf,
        colaRate: c.cola,
        growthRate: r() < 0.5 ? null : r() * 0.08,
        people: c.people,
        deathAgeYears: c.deathAge,
        endYear: 2100,
      };
      const axes: TopClaimsAxis[] = [0, 1].map((i) => {
        const w = legalClaimWindow(c.people[i], asOf)!;
        const months: MonthIndex[] = [];
        for (let m = w.earliest; m <= w.latest; m += 7) months.push(m);
        return { personIndex: i, months };
      });
      const grid = evaluateGrid(base, axes);
      axes[0].months.forEach((a, ia) =>
        axes[1].months.forEach((b, ib) => {
          expect(grid[ia][ib], `case ${k} cell ${ia},${ib}`).toBeCloseTo(evaluateScenario({ ...base, claimMonth: [a, b] }), 6);
        }),
      );
    }
  });
});

describe('property 6: growth off, scenario total equals the annual rollup', () => {
  it('evaluateScenario == sum of annual household rows minus the pre-asOf months of asOf.year', () => {
    const r = rng(6);
    for (let k = 0; k < CASES; k++) {
      const c = randomCase(r);
      const inputs = inputsOf(c);
      const res = computeSocialSecurity(inputs);
      const total = evaluateScenario(inputs);
      const rollup = res.annual.reduce((s, row) => s + row.household, 0);
      let before = 0;
      for (let t = res.firstMonth; t < mi(asOf.year, asOf.month); t++) {
        before += res.series.reduce((s, p) => s + p[t - res.firstMonth].own + p[t - res.firstMonth].spousal + p[t - res.firstMonth].survivor, 0);
      }
      expect(total, `case ${k}`).toBeCloseTo(rollup - before, 6);
      expect(total).toBeCloseTo(calculatorHouseholdMonthly(res, asOf).reduce((s, v) => s + v, 0), 6);
    }
  });
});

describe('death age drives the best claim month (single, PIA $1,000, FRA 67, no COLA, no growth)', () => {
  const single = piaPerson(1970, 4, 1000);
  const w = legalClaimWindow(single, asOf)!;
  const months: MonthIndex[] = Array.from({ length: w.latest - w.earliest + 1 }, (_, k) => w.earliest + k);
  const base = (deathAgeYears: number) => ({ asOf, colaRate: 0, growthRate: null, people: [single] as [SsPerson], deathAgeYears: [deathAgeYears], endYear: 2100 });
  const best = (deathAgeYears: number): MonthIndex =>
    topClaims(base(deathAgeYears), [{ personIndex: 0, months }], 1)[0].claimMonths[0]!;

  it('death age 63: the earliest legal month (62y1m) is the highest', () => {
    expect(best(63)).toBe(w.earliest);
    const grid = evaluateGrid(base(63), [{ personIndex: 0, months }])[0];
    expect(grid[0]).toBe(Math.max(...grid));
    expect(w.earliest - mi(1970, 4)).toBe(745);
  });

  it('death age 120: 70y0m is the highest', () => {
    expect(best(120)).toBe(w.latest);
    expect(w.latest - mi(1970, 4)).toBe(840);
  });

  it('changing the death age moves the top', () => {
    const tops = [63, 70, 78, 80, 85, 90, 120].map(best);
    expect(tops[0]).toBe(w.earliest);
    expect(tops[tops.length - 1]).toBe(w.latest);
    for (let i = 1; i < tops.length; i++) expect(tops[i]).toBeGreaterThanOrEqual(tops[i - 1]);
    expect(new Set(tops).size).toBeGreaterThan(3);
  });

  it('plateau: cells within $1 of each other tie, and the earlier claim month wins', () => {
    // Death month 917 months after birth: claiming at 746 and 747 months both total $121,125.
    const age = 917 / 12;
    const grid = evaluateGrid(base(age), [{ personIndex: 0, months }])[0];
    const hi = Math.max(...grid);
    const near = grid.map((v, i) => [v, i] as const).filter(([v]) => hi - v < 1).map(([, i]) => i);
    expect(near.length).toBeGreaterThanOrEqual(2);
    expect(Math.abs(grid[1] - grid[2])).toBeLessThan(1);
    expect(best(age)).toBe(months[Math.min(...near)]);
  });

  it('fractional-month death age rounds (not floors): 80.875y = 970.5 months -> death month 971', () => {
    // Claim at 70y0m (840 months): paid months are 840..970 = 131 months at 1.24 x PIA. Floor would give 130.
    const total = evaluateScenario({ ...base(80.875), claimMonth: [mi(1970, 4) + 840] });
    expect(total).toBeCloseTo(131 * 1240, 6);
  });
});

describe('selectTopClaims exact ties (synthetic)', () => {
  const tc = (total: number, a: number, b: number) => ({ claimMonths: [a, b], total }) as never;
  const sel = (c: unknown[], n: number) => selectTopClaims(c as never[], [0, 1], n) as unknown as { claimMonths: number[] }[];

  it('equal totals: smaller sum of claim months wins, regardless of input order', () => {
    // [100,200] sum 300 listed first; [150,120] sum 270 must win. Person-0 order alone would pick [100,200].
    const r = sel([tc(5, 100, 200), tc(5, 150, 120)], 1);
    expect(r[0].claimMonths).toEqual([150, 120]);
  });

  it('equal totals and equal sums: smaller person-0 month wins, regardless of input order', () => {
    const r = sel([tc(5, 200, 100), tc(5, 100, 200)], 1);
    expect(r[0].claimMonths).toEqual([100, 200]);
  });

  it('totals within a cent but not equal still rank by total (cent key)', () => {
    const r = sel([tc(5.001, 100, 100), tc(5.009, 300, 300)], 1);
    expect(r[0].claimMonths).toEqual([300, 300]);
  });
});
