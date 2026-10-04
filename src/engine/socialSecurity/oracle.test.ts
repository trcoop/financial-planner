import { describe, expect, it } from 'vitest';

import { topClaims } from './evaluate';
import { legalClaimWindow } from './benefit';
import { computeSocialSecurity } from './household';
import { evaluateScenario } from './scenario';
import { oracleHousehold } from './oracle.testutil';
import type { OraclePerson } from './oracle.testutil';
import {
  OSS_COUPLE_TOP3,
  OSS_COUPLE_X,
  OSS_E40_CAP,
  OSS_SINGLE,
} from './ossOracle.fixture';
import type { MonthIndex, SsInputs, SsPerson } from './types';

/**
 * FIN-169 oracle suite. Two independent references:
 *  1. `oracle.testutil.ts` - a from-scratch monthly loop (no engine imports).
 *  2. Frozen Open Social Security captures (`ossOracle.fixture.ts`).
 * Tolerance: per month within $1.00, cumulative within $1.00 x months elapsed. OSS shows only
 * whole-dollar annual cells, so OSS rows are compared per year (a year's allowed error is $1.00 x 12
 * months, and the measured error is <= $1 per cell) and cumulatively.
 */
const asOf = { year: 2026, month: 10 };
const mi = (year: number, month: number): MonthIndex => year * 12 + month - 1;
const PER_MONTH = 1.0;
const pia = (birthYear: number, birthMonth: number, amount: number): SsPerson => ({
  birthYear,
  birthMonth,
  benefit: { kind: 'pia', pia: amount },
});

function oraclePeople(people: SsPerson[], claims: MonthIndex[], deathAges: number[]): OraclePerson[] {
  return people.map((p, i) => {
    const birthIdx = mi(p.birthYear, p.birthMonth);
    return {
      birthIdx,
      pia: (p.benefit as { pia: number }).pia,
      claim: claims[i],
      death: birthIdx + Math.round(deathAges[i] * 12),
    };
  });
}

/** Engine vs independent oracle, month by month plus cumulative, over the whole horizon. */
function expectEngineMatchesOracle(inputs: SsInputs): void {
  const result = computeSocialSecurity(inputs);
  const op = oraclePeople(inputs.people, inputs.claimMonth as MonthIndex[], inputs.deathAgeYears as number[]);
  let cumulativeDiff = 0;
  for (let t = result.firstMonth; t <= result.lastMonth; t++) {
    const engine = result.series.reduce((s, person) => {
      const m = person[t - result.firstMonth];
      return s + m.own + m.spousal + m.survivor;
    }, 0);
    const diff = Math.abs(engine - oracleHousehold(op, t));
    cumulativeDiff += engine - oracleHousehold(op, t);
    expect(diff, `month ${t}`).toBeLessThanOrEqual(PER_MONTH);
    expect(Math.abs(cumulativeDiff), `cumulative at ${t}`).toBeLessThanOrEqual(PER_MONTH * (t - result.firstMonth + 1));
  }
}

/** Engine annual household rows vs a frozen OSS whole-dollar table. */
function expectAnnualMatchesOss(inputs: SsInputs, oss: Record<number, number>, skipYears: number[] = []): void {
  const result = computeSocialSecurity(inputs);
  let months = 0;
  let cumulative = 0;
  for (const row of result.annual) {
    months += 12;
    const expected = oss[row.year];
    if (expected === undefined || skipYears.includes(row.year)) continue;
    cumulative += row.household - expected;
    expect(Math.abs(row.household - expected), `year ${row.year}`).toBeLessThanOrEqual(PER_MONTH * 12);
    // Measured: OSS rounds each annual column to a whole dollar, so a household cell differs by < $1.
    expect(Math.abs(row.household - expected), `year ${row.year} measured rounding`).toBeLessThanOrEqual(1);
    expect(Math.abs(cumulative), `cumulative through ${row.year}`).toBeLessThanOrEqual(PER_MONTH * months);
  }
}

describe('independent oracle: single', () => {
  const person = pia(OSS_SINGLE.birthYear, OSS_SINGLE.birthMonth, OSS_SINGLE.pia);
  const inputsFor = (month: number, year: number): SsInputs => ({
    asOf,
    colaRate: 0,
    growthRate: null,
    people: [person],
    claimMonth: [mi(year, month)],
    deathAgeYears: [OSS_SINGLE.deathAgeYears],
    endYear: OSS_SINGLE.endYear,
  });

  for (const cell of OSS_SINGLE.cells) {
    const label = `${cell.month}/${cell.year}`;
    it(`engine == independent oracle, month by month: claim ${label}`, () => {
      expectEngineMatchesOracle(inputsFor(cell.month, cell.year));
    });

    it(`engine == OSS year table: claim ${label}`, () => {
      const oss: Record<number, number> = { [cell.year]: cell.firstAnnual };
      for (let y = cell.year + 1; y <= OSS_SINGLE.lastPaidYear; y++) oss[y] = cell.steadyAnnual;
      // E9: a delayed claim's claim-year row (and its PV) is intentionally lower than OSS.
      expectAnnualMatchesOss(inputsFor(cell.month, cell.year), oss, cell.delayedBeforeSeventy ? [cell.year] : []);
    });

    it(`total vs OSS PV: claim ${label}`, () => {
      const engine = evaluateScenario(inputsFor(cell.month, cell.year));
      if (!cell.delayedBeforeSeventy) {
        expect(Math.abs(engine - cell.ossPv)).toBeLessThan(1);
      } else {
        // Documented E9 divergence: engine never exceeds OSS, and the gap is under one year of credits.
        expect(engine).toBeLessThanOrEqual(cell.ossPv + 0.5);
        expect(cell.ossPv - engine).toBeLessThan(300);
        expect(cell.ossPv - engine).toBeGreaterThan(1);
      }
    });
  }

  it('frozen E9 deltas (OSS PV - engine) are the documented ones', () => {
    const expected: Record<string, number> = { '12/2037': 53, '1/2038': 80, '6/2038': 279.67, '11/2039': 146.33 };
    for (const cell of OSS_SINGLE.cells.filter((c) => c.delayedBeforeSeventy)) {
      const engine = evaluateScenario(inputsFor(cell.month, cell.year));
      expect(cell.ossPv - engine).toBeCloseTo(expected[`${cell.month}/${cell.year}`], 0);
    }
  });
});

describe('independent oracle: couple X exact cells', () => {
  for (const cell of OSS_COUPLE_X.cells) {
    const claims = [mi(cell.claim.a[0], cell.claim.a[1]), mi(cell.claim.b[0], cell.claim.b[1])];
    const inputs: SsInputs = {
      asOf,
      colaRate: 0,
      growthRate: null,
      people: [
        pia(OSS_COUPLE_X.a.birthYear, OSS_COUPLE_X.a.birthMonth, OSS_COUPLE_X.a.pia),
        pia(OSS_COUPLE_X.b.birthYear, OSS_COUPLE_X.b.birthMonth, OSS_COUPLE_X.b.pia),
      ],
      claimMonth: claims,
      deathAgeYears: [...OSS_COUPLE_X.deathAgeYears],
      endYear: OSS_COUPLE_X.endYear,
    };
    const label = `B ${cell.claim.b[1]}/${cell.claim.b[0]}`;

    it(`engine == independent oracle month by month: ${label}`, () => {
      expectEngineMatchesOracle(inputs);
    });

    it(`engine == OSS year table (own, spousal, survivor, E37 death boundary): ${label}`, () => {
      const oss: Record<number, number> = { ...cell.totals };
      for (let y = cell.steady.from; y <= cell.steady.to; y++) oss[y] = cell.steady.amount;
      for (let y = cell.steady.survivorFrom; y <= cell.steady.survivorTo; y++) oss[y] = cell.steady.survivorAmount;
      expectAnnualMatchesOss(inputs, oss);
      // After B's death (Jan 2059) nothing is paid; OSS prints "2059 and beyond $0".
      const result = computeSocialSecurity(inputs);
      for (const row of result.annual.filter((r) => r.year >= 2059)) expect(row.household).toBe(0);
    });

    it(`engine total == OSS PV: ${label}`, () => {
      expect(Math.abs(evaluateScenario(inputs) - cell.ossPv)).toBeLessThan(1);
    });
  }
});

describe('E37 death-month rule and E40 survivor base against OSS', () => {
  const people = [
    pia(OSS_COUPLE_X.a.birthYear, OSS_COUPLE_X.a.birthMonth, OSS_COUPLE_X.a.pia),
    pia(OSS_COUPLE_X.b.birthYear, OSS_COUPLE_X.b.birthMonth, OSS_COUPLE_X.b.pia),
  ] as [SsPerson, SsPerson];
  const e40: SsInputs = {
    asOf,
    colaRate: 0,
    growthRate: null,
    people,
    claimMonth: [mi(OSS_E40_CAP.claim.a[0], OSS_E40_CAP.claim.a[1]), mi(OSS_E40_CAP.claim.b[0], OSS_E40_CAP.claim.b[1])],
    deathAgeYears: [...OSS_E40_CAP.deathAgeYears],
    endYear: 2062,
  };

  it('E37: the person is paid through the month before the death month (A last paid Dec 2051, survivor from Jan 2052)', () => {
    const inputs: SsInputs = {
      ...e40,
      claimMonth: [mi(2036, 3), mi(2035, 3)],
      deathAgeYears: [...OSS_COUPLE_X.deathAgeYears],
    };
    const r = computeSocialSecurity(inputs);
    expect(r.deathMonths).toEqual([mi(2052, 1), mi(2059, 1)]);
    const own = (t: number) => r.series[0][t - r.firstMonth].own;
    expect(own(mi(2051, 12))).toBeCloseTo(3472, 6);
    expect(own(mi(2052, 1))).toBe(0);
    const surv = (t: number) => r.series[1][t - r.firstMonth].survivor;
    expect(surv(mi(2051, 12))).toBe(0);
    expect(surv(mi(2052, 1))).toBeCloseTo(3472, 6);
    // B: last payment Dec 2058, nothing in Jan 2059.
    const bTotal = (t: number) => {
      const m = r.series[1][t - r.firstMonth];
      return m.own + m.spousal + m.survivor;
    };
    expect(bTotal(mi(2058, 12))).toBeGreaterThan(0);
    expect(bTotal(mi(2059, 1))).toBe(0);
  });

  it('E40: deceased claimed at 70y0m -> survivor base = PIA x 1.24 (no cap); OSS pays B $41,664/yr from 2052', () => {
    const r = computeSocialSecurity({ ...e40, claimMonth: [mi(2036, 3), mi(2035, 3)], deathAgeYears: [...OSS_COUPLE_X.deathAgeYears] });
    const row = r.annual.find((a) => a.year === 2052)!;
    expect(row.household).toBeCloseTo(41664, 6);
    expect(row.perPerson[1].survivor).toBeCloseTo(41664, 6);
  });

  it('E40: deceased claimed before FRA -> base = PIA, capped at max(PIA x factor, 82.5% PIA) = $2,310 (OSS $27,720/yr)', () => {
    expectEngineMatchesOracle(e40);
    expectAnnualMatchesOss(e40, OSS_E40_CAP.annualTotals);
    const r = computeSocialSecurity(e40);
    expect(r.annual.find((a) => a.year === 2042)!.household).toBeCloseTo(OSS_E40_CAP.survivorAnnualFrom2042, 6);
    expect(r.annual.find((a) => a.year === 2042)!.perPerson[1].survivor).toBeCloseTo(27720, 6);
    expect(Math.abs(evaluateScenario(e40) - OSS_E40_CAP.ossPv)).toBeLessThan(1);
  });
});

describe('couple top-3 golden (frozen couple, OSS oracle)', () => {
  const people: [SsPerson, SsPerson] = [
    pia(OSS_COUPLE_TOP3.a.birthYear, OSS_COUPLE_TOP3.a.birthMonth, OSS_COUPLE_TOP3.a.pia),
    pia(OSS_COUPLE_TOP3.b.birthYear, OSS_COUPLE_TOP3.b.birthMonth, OSS_COUPLE_TOP3.b.pia),
  ];
  const base = {
    asOf,
    colaRate: 0,
    growthRate: null,
    people,
    deathAgeYears: [...OSS_COUPLE_TOP3.deathAgeYears],
    endYear: OSS_COUPLE_TOP3.endYear,
  };
  const axis = (i: number) => {
    const w = legalClaimWindow(people[i], asOf)!;
    return { personIndex: i, months: Array.from({ length: w.latest - w.earliest + 1 }, (_, k) => w.earliest + k) };
  };

  it('engine top-3 cells and ordering equal the frozen golden', () => {
    const top = topClaims(base, [axis(0), axis(1)], 3);
    expect(top.map((t) => t.claimMonths)).toEqual(OSS_COUPLE_TOP3.top3.map((t) => [...t.claimMonths]));
    top.forEach((t, i) => expect(t.total).toBeCloseTo(OSS_COUPLE_TOP3.top3[i].total, 6));
  });

  it('OSS prices the same three cells in the same order; the gap is exactly the E9 January delta', () => {
    const pvs = OSS_COUPLE_TOP3.top3.map((t) => t.ossPv);
    expect([...pvs].sort((x, y) => y - x)).toEqual(pvs);
    for (const t of OSS_COUPLE_TOP3.top3) {
      expect(Math.abs(t.ossPv - t.total - t.e9Delta)).toBeLessThan(1);
    }
    // OSS's own recommended strategy is a cell the engine does not rank first (E9 divergence only).
    expect(OSS_COUPLE_TOP3.ossRecommended.ossPv).toBeGreaterThan(pvs[0]);
  });

  it('A at 70y0m in every top cell: no January-rule effect on A; B alone differs from OSS', () => {
    for (const t of OSS_COUPLE_TOP3.top3) {
      expect(t.claimMonths[0]).toBe(mi(2036, 3));
    }
  });

  it('each top cell matches the independent oracle month by month', () => {
    for (const t of OSS_COUPLE_TOP3.top3) {
      expectEngineMatchesOracle({ ...base, claimMonth: [...t.claimMonths] as MonthIndex[] });
    }
  });
});
