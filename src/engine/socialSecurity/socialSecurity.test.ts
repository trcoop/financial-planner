import { describe, expect, it } from 'vitest';

import { InvalidProjectionInputError } from '../errors';
import type { ProjectionErrorCode } from '../errors';
import * as ss from './index';
import type { SsErrorCode, SsInputs } from './index';

const asOf = { year: 2026, month: 9 };
const person = { birthYear: 1964, birthMonth: 9, benefit: { kind: 'pia' as const, pia: 2000 } };

describe('constants', () => {
  it('DEFAULT_DEATH_AGE_YEARS is 83.685', () => {
    expect(ss.DEFAULT_DEATH_AGE_YEARS).toBe(83.685);
  });
  it('defaultDeathAgeYears = max(83.685, currentAge + 1), unrounded', () => {
    expect(ss.defaultDeathAgeYears(62)).toBe(83.685);
    expect(ss.defaultDeathAgeYears(83.5)).toBe(84.5);
    expect(ss.defaultDeathAgeYears(90)).toBe(91);
  });
  it('defaultDeathAgeYears rejects non-finite input', () => {
    expect(() => ss.defaultDeathAgeYears(Number.NaN)).toThrow(InvalidProjectionInputError);
  });
  it('FRA table matches ERD section 4 (plus survivor-only 1941/1942)', () => {
    const t = ss.FRA_MONTHS_BY_BIRTH_YEAR;
    expect([t[1941], t[1942], t[1943], t[1954]]).toEqual([788, 790, 792, 792]);
    expect([t[1955], t[1956], t[1957], t[1958], t[1959], t[1960]]).toEqual([794, 796, 798, 800, 802, 804]);
    expect(ss.FRA_MONTHS_AFTER_TABLE).toBe(804);
  });
});

describe('barrel re-exports age helpers', () => {
  it('exposes planCalendarYear, calculatorStartMonth, firstClaimableMonth', () => {
    expect(ss.planCalendarYear(asOf, 2)).toBe(2028);
    expect(ss.calculatorStartMonth(asOf)).toBe(2026 * 12 + 8);
    expect(ss.firstClaimableMonth(asOf)).toBe(2026 * 12 + 9);
  });
});

describe('stubs throw SS_NOT_IMPLEMENTED with the typed error class', () => {
  const inputs: SsInputs = {
    asOf,
    colaRate: 0.025,
    growthRate: null,
    people: [person],
    claimMonth: [2030 * 12],
    endYear: 2050,
  };
  const noDeath: Omit<SsInputs, 'deathAgeYears'> = inputs;
  const noClaim: Omit<SsInputs, 'claimMonth'> = inputs;
  const calls: [string, () => unknown][] = [
    ['survivorBreakdown', () => ss.survivorBreakdown({} as ss.SurvivorArgs)],
    ['computeSocialSecurity', () => ss.computeSocialSecurity(inputs)],
    ['growthBalance', () => ss.growthBalance([1], null)],
    ['evaluateScenario', () => ss.evaluateScenario(inputs)],
    ['evaluateGrid', () => ss.evaluateGrid(noClaim, [])],
    ['topClaims', () => ss.topClaims(noClaim, [])],
    ['findCrossings', () => ss.findCrossings([[1]], 0)],
    ['buildSsAnnualSchedule', () => ss.buildSsAnnualSchedule(noDeath)],
  ];
  it.each(calls)('%s', (_name, fn) => {
    let caught: unknown;
    try {
      fn();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvalidProjectionInputError);
    expect((caught as InvalidProjectionInputError).code).toBe('SS_NOT_IMPLEMENTED');
  });
});

describe('type-level contracts', () => {
  it('computeOwnAndSpousal rejects an object literal carrying deathAgeYears', () => {
    const fn = () =>
      ss.computeOwnAndSpousal({
        asOf,
        colaRate: 0,
        growthRate: null,
        people: [person],
        claimMonth: [null],
        endYear: 2030,
        // @ts-expect-error deathAgeYears is omitted from the input type
        deathAgeYears: [83],
      });
    expect(fn).toThrow();
  });
  it('SsErrorCode accepts SS_ codes and rejects TAX_ codes', () => {
    const ok: SsErrorCode = 'SS_CLAIM_AFTER_70';
    // @ts-expect-error a TAX_ code is not an SsErrorCode
    const bad: SsErrorCode = 'TAX_YEAR_NOT_INTEGER';
    const asProjection: ProjectionErrorCode = ok;
    expect([ok, bad, asProjection]).toHaveLength(3);
  });
});
