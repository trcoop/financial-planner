import { describe, expect, it } from 'vitest';

import {
  ageMonthsAt,
  ageYearsExactAt,
  birthMonthIndex,
  calculatorStartMonth,
  calendarAge,
  firstClaimableMonth,
  monthIndex,
  planCalendarYear,
} from './age';
import type { InvalidProjectionInputError } from './errors';

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as InvalidProjectionInputError).code;
  }
  return undefined;
};

describe('monthIndex', () => {
  it('is year*12 + (month-1)', () => {
    expect(monthIndex(2026, 1)).toBe(2026 * 12);
    expect(monthIndex(2026, 9)).toBe(2026 * 12 + 8);
    expect(monthIndex(2026, 12)).toBe(2026 * 12 + 11);
  });
  it('rejects a bad month or fractional year with SS_INVALID_AS_OF', () => {
    expect(codeOf(() => monthIndex(2026, 13))).toBe('SS_INVALID_AS_OF');
    expect(codeOf(() => monthIndex(2026.5, 1))).toBe('SS_INVALID_AS_OF');
  });
  it('rejects non-finite input with NON_FINITE_INPUT', () => {
    expect(codeOf(() => monthIndex(Number.NaN, 1))).toBe('NON_FINITE_INPUT');
  });
});

describe('birthMonthIndex', () => {
  it('maps birth year/month to a MonthIndex', () => {
    expect(birthMonthIndex(1960, 3)).toBe(1960 * 12 + 2);
  });
  it('throws SS_INVALID_BIRTH for bad months or fractional years', () => {
    expect(codeOf(() => birthMonthIndex(1960, 0))).toBe('SS_INVALID_BIRTH');
    expect(codeOf(() => birthMonthIndex(1960, 13))).toBe('SS_INVALID_BIRTH');
    expect(codeOf(() => birthMonthIndex(1960, 2.5))).toBe('SS_INVALID_BIRTH');
    expect(codeOf(() => birthMonthIndex(1960.5, 2))).toBe('SS_INVALID_BIRTH');
  });
  it('throws NON_FINITE_INPUT for NaN/Infinity', () => {
    expect(codeOf(() => birthMonthIndex(Number.NaN, 2))).toBe('NON_FINITE_INPUT');
    expect(codeOf(() => birthMonthIndex(1960, Infinity))).toBe('NON_FINITE_INPUT');
  });
});

describe('ageMonthsAt / ageYearsExactAt', () => {
  it('counts completed calendar months from birth month to asOf month', () => {
    expect(ageMonthsAt(1964, 9, { year: 2026, month: 9 })).toBe(62 * 12);
    expect(ageMonthsAt(1964, 10, { year: 2026, month: 9 })).toBe(62 * 12 - 1);
    expect(ageMonthsAt(1964, 8, { year: 2026, month: 9 })).toBe(62 * 12 + 1);
  });
  it('returns ageYearsExact = ageMonths / 12 unrounded', () => {
    expect(ageYearsExactAt(1964, 9, { year: 2026, month: 9 })).toBe(62);
    expect(ageYearsExactAt(1964, 6, { year: 2026, month: 9 })).toBe(62.25);
  });
  it('validates asOf', () => {
    expect(codeOf(() => ageMonthsAt(1964, 9, { year: 2026, month: 0 }))).toBe('SS_INVALID_AS_OF');
  });
});

describe('calendarAge', () => {
  it('is asOf.year - birthYear (E26)', () => {
    expect(calendarAge(1964, { year: 2026, month: 1 })).toBe(62);
    expect(calendarAge(1964, { year: 2026, month: 12 })).toBe(62);
  });
  it('validates inputs', () => {
    expect(codeOf(() => calendarAge(1964.5, { year: 2026, month: 1 }))).toBe('SS_INVALID_BIRTH');
    expect(codeOf(() => calendarAge(1964, { year: 2026, month: 14 }))).toBe('SS_INVALID_AS_OF');
  });
});

describe('calculatorStartMonth / firstClaimableMonth (O17, R5)', () => {
  it('asOf 2026-09: start = Sep 2026, first claimable = Oct 2026', () => {
    expect(calculatorStartMonth({ year: 2026, month: 9 })).toBe(monthIndex(2026, 9));
    expect(firstClaimableMonth({ year: 2026, month: 9 })).toBe(monthIndex(2026, 10));
  });
  it('asOf 2026-12: first claimable rolls to Jan 2027', () => {
    expect(calculatorStartMonth({ year: 2026, month: 12 })).toBe(monthIndex(2026, 12));
    expect(firstClaimableMonth({ year: 2026, month: 12 })).toBe(monthIndex(2027, 1));
  });
  it('validates asOf', () => {
    expect(codeOf(() => calculatorStartMonth({ year: 2026, month: 0 }))).toBe('SS_INVALID_AS_OF');
    expect(codeOf(() => firstClaimableMonth({ year: 2026.1, month: 1 }))).toBe('SS_INVALID_AS_OF');
  });
});

describe('planCalendarYear (E14/E22)', () => {
  it('offset 0 is asOf.year and offset n is asOf.year + n', () => {
    const asOf = { year: 2026, month: 9 };
    expect(planCalendarYear(asOf, 0)).toBe(2026);
    for (const n of [1, 5, 40]) expect(planCalendarYear(asOf, n)).toBe(2026 + n);
  });
  it('validates asOf and offset', () => {
    expect(codeOf(() => planCalendarYear({ year: 2026, month: 13 }, 0))).toBe('SS_INVALID_AS_OF');
    expect(codeOf(() => planCalendarYear({ year: 2026, month: 1 }, Number.NaN))).toBe('NON_FINITE_INPUT');
  });
});
