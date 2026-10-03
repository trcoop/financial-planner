import { describe, expect, it } from 'vitest';

import { calculatorStartMonth, monthIndex } from '../age';
import { findCrossings } from './crossings';
import { GOLDEN_FIXTURES } from './goldenFixtures';
import { growthBalance } from './growth';
import { computeSocialSecurity } from './household';
import { calculatorHouseholdMonthly, evaluateScenario } from './scenario';
import { computeOwnAndSpousal } from './spousal';
import type { SsInputs, SsPerson } from './types';

const piaPerson = (birthYear: number, birthMonth: number, pia: number): SsPerson => ({
  birthYear,
  birthMonth,
  benefit: { kind: 'pia', pia },
});

describe('G11 fixtures (ERD 12.19.1): plan annual keeps the full calendar year', () => {
  it('G11a: 24,000 and series[0][0].own = 2,000 (January)', () => {
    const { inputs } = GOLDEN_FIXTURES.G11a;
    const r = computeOwnAndSpousal(inputs);
    expect(r.annual.find((row) => row.year === inputs.asOf.year)?.household).toBe(24000);
    expect(r.series[0][0].own).toBe(2000);
  });
  it('G11b: 18,000 (9 months from April)', () => {
    const { inputs } = GOLDEN_FIXTURES.G11b;
    const r = computeOwnAndSpousal(inputs);
    expect(r.annual.find((row) => row.year === inputs.asOf.year)?.household).toBe(18000);
  });
});

describe('O17 option (b): calculator totals, growth and crossings start at the asOf month (ERD 12.26 tests 1-5)', () => {
  const { inputs } = GOLDEN_FIXTURES.G11a; // asOf June 2026, collecting 2,000/month, endYear = asOf.year

  it('(1) plan annual for asOf.year is 24,000 (12 months)', () => {
    const r = computeOwnAndSpousal(inputs);
    expect(r.annual[0].year).toBe(2026);
    expect(r.annual[0].household).toBe(24000);
  });

  it('(2) evaluateScenario with growth null = 14,000 (June..December, 7 x 2,000)', () => {
    expect(evaluateScenario(inputs)).toBe(14000);
  });

  it('(3) the first cumulative element handed to findCrossings is 2,000 at calculatorStartMonth(asOf)', () => {
    const slice = calculatorHouseholdMonthly(computeSocialSecurity(inputs), inputs.asOf);
    expect(slice).toHaveLength(7);
    expect(growthBalance(slice, null)[0]).toBe(2000);
    expect(calculatorStartMonth(inputs.asOf)).toBe(monthIndex(2026, 6));
  });

  it('(4) growth on: total equals the recursion started in June and differs from the 12-month one', () => {
    const withGrowth = { ...inputs, growthRate: 0.045 };
    const slice7 = Array.from({ length: 7 }, () => 2000);
    const slice12 = Array.from({ length: 12 }, () => 2000);
    const expected7 = growthBalance(slice7, 0.045).at(-1) as number;
    expect(evaluateScenario(withGrowth)).toBeCloseTo(expected7, 8);
    expect(Math.abs(evaluateScenario(withGrowth) - (growthBalance(slice12, 0.045).at(-1) as number))).toBeGreaterThan(1000);
  });

  it('(5) a pia person is identical under the January and the asOf-month start index', () => {
    const pia: SsInputs = {
      asOf: { year: 2026, month: 9 },
      colaRate: 0.02,
      growthRate: 0.03,
      people: [piaPerson(1964, 12, 2000)],
      claimMonth: [monthIndex(2028, 3)],
      deathAgeYears: [85],
      endYear: 2050,
    };
    const r = computeSocialSecurity(pia);
    const monthly = r.series.map((s) => s).reduce<number[]>((acc, s) => {
      s.forEach((c, i) => {
        acc[i] = (acc[i] ?? 0) + c.own + c.spousal + c.survivor;
      });
      return acc;
    }, []);
    const fromJanuary = growthBalance(monthly, 0.03).at(-1) as number;
    expect(evaluateScenario(pia)).toBeCloseTo(fromJanuary, 6);
    expect(evaluateScenario({ ...pia, growthRate: null })).toBeCloseTo(monthly.reduce((a, b) => a + b, 0), 6);
  });
});

describe('evaluateScenario basics', () => {
  it('equals the last growthBalance value of the calculator slice (growth on and off)', () => {
    const inputs: SsInputs = { ...GOLDEN_FIXTURES.E29.inputs, growthRate: 0.04 };
    const slice = calculatorHouseholdMonthly(computeSocialSecurity(inputs), inputs.asOf);
    expect(evaluateScenario(inputs)).toBeCloseTo(growthBalance(slice, 0.04).at(-1) as number, 6);
    expect(evaluateScenario({ ...inputs, growthRate: null })).toBeCloseTo(slice.reduce((a, b) => a + b, 0), 6);
  });
  it('growth on exceeds growth off for a positive stream', () => {
    const base = GOLDEN_FIXTURES.E33a.inputs;
    expect(evaluateScenario({ ...base, growthRate: 0.03 })).toBeGreaterThan(evaluateScenario(base));
  });
  it('rejects invalid growth rate', () => {
    expect(() => evaluateScenario({ ...GOLDEN_FIXTURES.E33a.inputs, growthRate: 0.3 })).toThrow();
  });
});

describe('E21 two-person crossing-year golden', () => {
  // Inputs recorded here (no COLA, no growth, no deaths), asOf Sept 2026, endYear 2050:
  //   two people, both born December 1964 (FRA 67y0m = Dec 2031; 62y1m = Jan 2027), PIA 2,000 each
  //   (neither gets a spousal top-up: ownPia >= half of the other's).
  //   Plan A: both claim Jan 2027 (70.4167% = 1,408.333 each, household 2,816.667/month).
  //   Plan B: both claim Dec 2031 (100% each, household 4,000/month).
  // By hand: after Dec 2031 + j months, A has 60 + j payments, B has j + 1. B passes A when
  //   4,000 (j + 1) > 2,816.667 (60 + j)  <=>  j > 139.44, so j = 140: August 2043.
  const common = {
    asOf: { year: 2026, month: 9 },
    colaRate: 0,
    growthRate: null,
    people: [piaPerson(1964, 12, 2000), piaPerson(1964, 12, 2000)] as [SsPerson, SsPerson],
    endYear: 2050,
  };
  const planA: SsInputs = { ...common, claimMonth: [monthIndex(2027, 1), monthIndex(2027, 1)] };
  const planB: SsInputs = { ...common, claimMonth: [monthIndex(2031, 12), monthIndex(2031, 12)] };

  it('B passes A in August 2043, once, and the final totals agree with the crossing', () => {
    const cum = [planA, planB].map((p) =>
      growthBalance(calculatorHouseholdMonthly(computeSocialSecurity(p), p.asOf), null),
    );
    const crossings = findCrossings(cum, calculatorStartMonth(common.asOf));
    expect(crossings).toEqual([{ leader: 1, trailer: 0, month: monthIndex(2043, 8) }]);
    expect(evaluateScenario(planA)).toBeCloseTo(288 * 2816.666667, 2); // Jan 2027..Dec 2050 = 288 months
    expect(evaluateScenario(planB)).toBeCloseTo(229 * 4000, 2); // Dec 2031..Dec 2050 = 229 months
    // starts (events after crossings) are month-ordered and deaths are absent
    const r = computeSocialSecurity(planB);
    expect(r.starts.map((s) => s.month)).toEqual([monthIndex(2031, 12), monthIndex(2031, 12)]);
    expect(r.deathMonths).toEqual([null, null]);
  });
});
