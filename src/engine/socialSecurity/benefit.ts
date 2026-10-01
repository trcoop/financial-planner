/**
 * WP-B: own retirement benefit: FRA, early-claim reductions and delayed credits, the January rule
 * (ERD §4, §12.5; PRD E5-E9, E28), the legal claim window (§12.1) and the already-collecting inverse
 * (PRD E7). Pure; no rounding anywhere (§12.3). Amounts here are FRACTIONS of PIA (base, pre-COLA).
 */
import { birthMonthIndex, calculatorStartMonth, firstClaimableMonth } from '../age';
import { InvalidProjectionInputError } from '../errors';
import {
  EARLIEST_CLAIM_OFFSET_MONTHS,
  FRA_MONTHS_AFTER_TABLE,
  FRA_MONTHS_BY_BIRTH_YEAR,
  LATEST_CLAIM_OFFSET_MONTHS,
  MIN_SUPPORTED_BIRTH_YEAR,
} from './constants';
import type { AsOf, MonthIndex, SsPerson } from './types';

function requireFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new InvalidProjectionInputError('NON_FINITE_INPUT', `${name} must be a finite number (got ${value})`);
  }
}

function requireIntegerYear(birthYear: number): void {
  requireFinite(birthYear, 'birthYear');
  if (!Number.isInteger(birthYear)) {
    throw new InvalidProjectionInputError('SS_INVALID_BIRTH', `birthYear must be an integer (got ${birthYear})`);
  }
}

/** FRA in months for a table row that may predate 1943 (survivor lookup only). */
function fraLookup(year: number): number {
  return FRA_MONTHS_BY_BIRTH_YEAR[year] ?? FRA_MONTHS_AFTER_TABLE;
}

/** FRA in months for `birthYear` (792..804, ERD §4). Throws for births before 1943. */
export function fraMonths(birthYear: number): number {
  requireIntegerYear(birthYear);
  if (birthYear < MIN_SUPPORTED_BIRTH_YEAR) {
    throw new InvalidProjectionInputError(
      'SS_UNSUPPORTED_BIRTH_YEAR',
      `birth years before ${MIN_SUPPORTED_BIRTH_YEAR} are not supported (got ${birthYear})`,
    );
  }
  return fraLookup(birthYear);
}

/** `fraMonths(birthYear - 2)` semantics, defined for 1943+ (the table carries 1941/1942 for this only). */
export function survivorFraMonths(birthYear: number): number {
  requireIntegerYear(birthYear);
  if (birthYear < MIN_SUPPORTED_BIRTH_YEAR) {
    throw new InvalidProjectionInputError(
      'SS_UNSUPPORTED_BIRTH_YEAR',
      `birth years before ${MIN_SUPPORTED_BIRTH_YEAR} are not supported (got ${birthYear})`,
    );
  }
  return fraLookup(birthYear - 2);
}

/** Birth month index of `p`, after validating birth and the supported birth-year range. */
function validatedBirthIdx(p: SsPerson): MonthIndex {
  const idx = birthMonthIndex(p.birthYear, p.birthMonth);
  fraMonths(p.birthYear);
  return idx;
}

/**
 * Legal window for the person's OWN start month. Not collecting: 62y1m..70y0m, with the earliest
 * clamped to the month after `asOf` (a claim at or before asOf is `SS_CLAIM_IN_PAST`); `null` when
 * that leaves nothing (e.g. already past 70). Collecting: the window their `sinceMonth` must fall in,
 * 62y1m..min(70y0m, asOf month); `null` if empty.
 */
export function legalClaimWindow(p: SsPerson, asOf: AsOf): { earliest: MonthIndex; latest: MonthIndex } | null {
  const birthIdx = validatedBirthIdx(p);
  const first = birthIdx + EARLIEST_CLAIM_OFFSET_MONTHS;
  const last = birthIdx + LATEST_CLAIM_OFFSET_MONTHS;
  const window =
    p.benefit.kind === 'collecting'
      ? { earliest: first, latest: Math.min(last, calculatorStartMonth(asOf)) }
      : { earliest: Math.max(first, firstClaimableMonth(asOf)), latest: last };
  return window.earliest > window.latest ? null : window;
}

function requireClaimAge(claimAgeMonths: number): void {
  requireFinite(claimAgeMonths, 'claimAgeMonths');
  if (!Number.isInteger(claimAgeMonths)) {
    throw new InvalidProjectionInputError('SS_INVALID_BIRTH', `claim age must be whole months (got ${claimAgeMonths})`);
  }
  if (claimAgeMonths < EARLIEST_CLAIM_OFFSET_MONTHS) {
    throw new InvalidProjectionInputError(
      'SS_CLAIM_BEFORE_ELIGIBLE',
      `claim age ${claimAgeMonths} months is before 62y1m (${EARLIEST_CLAIM_OFFSET_MONTHS})`,
    );
  }
  if (claimAgeMonths > LATEST_CLAIM_OFFSET_MONTHS) {
    throw new InvalidProjectionInputError(
      'SS_CLAIM_AFTER_70',
      `claim age ${claimAgeMonths} months is after 70y0m (${LATEST_CLAIM_OFFSET_MONTHS})`,
    );
  }
}

/** Fraction of PIA for `d = claim age - FRA` months with credits/reductions fully applied. */
function factorForOffset(d: number): number {
  if (d >= 0) return 1 + d / 150; // 2/3 % per month
  if (d >= -36) return 1 + d / 180; // 5/9 % per month, first 36 months
  return 0.8 + (d + 36) / 240; // 5/12 % per month beyond 36
}

/** Steady-state (post-January) fraction of PIA for a claim at `claimAgeMonths` (ERD §6 table). */
export function ownFactorSteady(fraMonthsValue: number, claimAgeMonths: number): number {
  requireFinite(fraMonthsValue, 'fraMonths');
  requireClaimAge(claimAgeMonths);
  return factorForOffset(claimAgeMonths - fraMonthsValue);
}

/**
 * Fraction of PIA payable in month `at` for a claim in month `claim`, with the January rule (ERD §12.5):
 * 0 before the claim; early claims constant; a delayed claim before 70y0m counts, while `at` is in the
 * claim year, only credits earned through December of the prior year (months from the FRA month up to
 * but excluding that December), then the full count from the next January; a claim at 70y0m is steady
 * from the first month.
 */
export function ownFactorAt(p: SsPerson, claim: MonthIndex, at: MonthIndex): number {
  const birthIdx = validatedBirthIdx(p);
  requireFinite(claim, 'claim');
  requireFinite(at, 'at');
  const claimAge = claim - birthIdx;
  requireClaimAge(claimAge);
  if (at < claim) return 0;
  const fra = fraMonths(p.birthYear);
  const d = claimAge - fra;
  const claimYear = Math.floor(claim / 12);
  if (d <= 0 || claimAge >= LATEST_CLAIM_OFFSET_MONTHS || Math.floor(at / 12) > claimYear) {
    return factorForOffset(d);
  }
  const creditedThroughDecember = claimYear * 12 - 1 - (birthIdx + fra);
  return factorForOffset(Math.max(0, Math.min(d, creditedThroughDecember)));
}

/**
 * Already-collecting inverse (PRD E7): PIA = check / own factor payable at the asOf month (the January
 * rule applies when the start year is asOf.year). The check is the gross OWN benefit; $0 is valid.
 * Throws `SS_INVALID_ALREADY_COLLECTING` for a non-collecting person or a start outside
 * 62y1m..min(70y0m, asOf month).
 */
export function collectingPia(p: SsPerson, asOf: AsOf): number {
  if (p.benefit.kind !== 'collecting') {
    throw new InvalidProjectionInputError(
      'SS_INVALID_ALREADY_COLLECTING',
      'collectingPia requires a person whose benefit.kind is "collecting"',
    );
  }
  const { check, sinceMonth } = p.benefit;
  requireFinite(check, 'check');
  requireFinite(sinceMonth, 'sinceMonth');
  if (check < 0) {
    throw new InvalidProjectionInputError('SS_NEGATIVE_BENEFIT', `check must be >= 0 (got ${check})`);
  }
  const window = legalClaimWindow(p, asOf);
  if (window === null || !Number.isInteger(sinceMonth) || sinceMonth < window.earliest || sinceMonth > window.latest) {
    throw new InvalidProjectionInputError(
      'SS_INVALID_ALREADY_COLLECTING',
      'sinceMonth must be a month between 62y1m and 70y0m, and not after asOf',
    );
  }
  return check / ownFactorAt(p, sinceMonth, calculatorStartMonth(asOf));
}
