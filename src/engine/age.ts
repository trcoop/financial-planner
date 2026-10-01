/**
 * Neutral age / calendar-month helpers (PRD E1, E26, E27; SS ERD §12.19.5, §12.25, §12.26).
 *
 * This is the canonical home of `AsOf` and `MonthIndex`. Storage and UI import them from here,
 * with no coupling to the Social Security module internals. Pure: nothing here reads a clock —
 * callers inject `asOf`.
 *
 * Two age notions coexist (E26):
 *  - outside Social Security, age is the calendar-year difference `asOf.year - birthYear`
 *    ({@link calendarAge});
 *  - inside the Social Security module (and the death-age default), age is month-precise
 *    ({@link ageMonthsAt}, {@link ageYearsExactAt}).
 */
import { InvalidProjectionInputError } from './errors';

/** Injected "today": `month` is 1-12. The engine never reads a clock (E27). */
export interface AsOf {
  year: number;
  month: number;
}

/** Calendar month index: `year * 12 + (month - 1)`. Not a projection offset. */
export type MonthIndex = number;

function requireFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new InvalidProjectionInputError('NON_FINITE_INPUT', `${name} must be a finite number (got ${value})`);
  }
}

/** Validates an `AsOf`; throws `SS_INVALID_AS_OF` (or `NON_FINITE_INPUT`). */
function validateAsOf(asOf: AsOf): void {
  requireFinite(asOf.year, 'asOf.year');
  requireFinite(asOf.month, 'asOf.month');
  if (!Number.isInteger(asOf.year) || !Number.isInteger(asOf.month) || asOf.month < 1 || asOf.month > 12) {
    throw new InvalidProjectionInputError(
      'SS_INVALID_AS_OF',
      `asOf must have an integer year and an integer month 1-12 (got ${asOf.year}-${asOf.month})`,
    );
  }
}

/** `year*12 + (month-1)`. Throws `SS_INVALID_AS_OF` for a non-integer year or month outside 1-12. */
export function monthIndex(year: number, month: number): MonthIndex {
  validateAsOf({ year, month });
  return year * 12 + (month - 1);
}

/** MonthIndex of a person's birth month. Throws `SS_INVALID_BIRTH` (or `NON_FINITE_INPUT`). */
export function birthMonthIndex(birthYear: number, birthMonth: number): MonthIndex {
  requireFinite(birthYear, 'birthYear');
  requireFinite(birthMonth, 'birthMonth');
  if (!Number.isInteger(birthYear) || !Number.isInteger(birthMonth) || birthMonth < 1 || birthMonth > 12) {
    throw new InvalidProjectionInputError(
      'SS_INVALID_BIRTH',
      `birth must have an integer year and an integer month 1-12 (got ${birthYear}-${birthMonth})`,
    );
  }
  return birthYear * 12 + (birthMonth - 1);
}

/** Completed calendar months from the birth month to the asOf month (SS module only). */
export function ageMonthsAt(birthYear: number, birthMonth: number, asOf: AsOf): number {
  const birth = birthMonthIndex(birthYear, birthMonth);
  validateAsOf(asOf);
  return asOf.year * 12 + (asOf.month - 1) - birth;
}

/** `ageMonthsAt / 12`, unrounded (SS module and the death-age default only). */
export function ageYearsExactAt(birthYear: number, birthMonth: number, asOf: AsOf): number {
  return ageMonthsAt(birthYear, birthMonth, asOf) / 12;
}

/** Calendar-year age `asOf.year - birthYear` (E26): projection, Medicare, retirement gates, tax age. */
export function calendarAge(birthYear: number, asOf: AsOf): number {
  birthMonthIndex(birthYear, 1);
  validateAsOf(asOf);
  return asOf.year - birthYear;
}

/**
 * First month counted by the CALCULATOR's totals, growth and crossings (§12.26): the asOf month
 * itself. Plan annual rows still cover the full calendar year.
 */
export function calculatorStartMonth(asOf: AsOf): MonthIndex {
  validateAsOf(asOf);
  return asOf.year * 12 + (asOf.month - 1);
}

/**
 * First month a not-yet-collecting claim may legally start: the month AFTER the asOf month
 * (a claim at or before asOf is `SS_CLAIM_IN_PAST`). The single clamp target for stale claims.
 */
export function firstClaimableMonth(asOf: AsOf): MonthIndex {
  return calculatorStartMonth(asOf) + 1;
}

/** The single plan-start mapping (E14/E22): projection offset `t` is calendar year `asOf.year + t`. */
export function planCalendarYear(asOf: AsOf, offset: number): number {
  validateAsOf(asOf);
  requireFinite(offset, 'offset');
  return asOf.year + offset;
}
