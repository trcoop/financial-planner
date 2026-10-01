/**
 * WP-D: survivor benefit (ERD §12.4; PRD E10, E37, E40, E41, E42). Pure; no rounding (§12.3).
 * Statutory order: age-reduce the base, then cap at RIB-LIM `max(deceasedRIB, 0.825 x PIA)` (only when
 * the deceased claimed before FRA), then the household is paid `max(own, survivor)`.
 * `survivorFraMonths` lives in `benefit.ts` (FIN-163) and is re-exported from the barrel.
 */
import { birthMonthIndex } from '../age';
import { InvalidProjectionInputError } from '../errors';
import { fraMonths, ownFactorSteady, survivorFraMonths } from './benefit';
import { LATEST_CLAIM_OFFSET_MONTHS } from './constants';
import type { MonthIndex, SurvivorArgs } from './types';

/** Survivor benefit is first payable at 60y1m (month after the 60th-birthday month), PRD E41. */
const SURVIVOR_EARLIEST_AGE_MONTHS = 721;
const AGE_60_MONTHS = 720;
/** Maximum survivor age reduction at 60y0m (28.5%). */
const MAX_SURVIVOR_REDUCTION = 0.285;
const RIB_LIM_FRACTION = 0.825;

function requireFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new InvalidProjectionInputError('NON_FINITE_INPUT', `${name} must be a finite number (got ${value})`);
  }
}

function requireMonth(value: number, name: string): void {
  requireFinite(value, name);
  if (!Number.isInteger(value)) {
    throw new InvalidProjectionInputError('SS_INVALID_DEATH', `${name} must be a whole calendar month index`);
  }
}

/** Later of the death month and the month after the survivor's 60th-birthday month (PRD P6/E41). */
export function survivorStartMonth(deathMonth: MonthIndex, survivorBirthYear: number, survivorBirthMonth: number): MonthIndex {
  requireMonth(deathMonth, 'deathMonth');
  const birthIdx = birthMonthIndex(survivorBirthYear, survivorBirthMonth);
  return Math.max(deathMonth, birthIdx + SURVIVOR_EARLIEST_AGE_MONTHS);
}

/**
 * E10 payment window for the survivor benefit: first = deceased's death month; last = the month before
 * the survivor's own death month (`null` = no survivor death, open-ended). Returns `null` when no survivor
 * payment is ever made (same-month deaths, or the survivor died first).
 */
export function survivorPaymentWindow(
  deceasedDeathMonth: MonthIndex,
  survivorDeathMonth: MonthIndex | null,
): { first: MonthIndex; last: MonthIndex | null } | null {
  requireMonth(deceasedDeathMonth, 'deceasedDeathMonth');
  if (survivorDeathMonth === null) return { first: deceasedDeathMonth, last: null };
  requireMonth(survivorDeathMonth, 'survivorDeathMonth');
  const last = survivorDeathMonth - 1;
  return last < deceasedDeathMonth ? null : { first: deceasedDeathMonth, last };
}

/** Household check after the death: the larger of own and survivor benefit, never both (PRD E10). */
export function paidBenefit(own: number, survivor: number): number {
  return Math.max(own, survivor);
}

/** BASE $/month at the survivor start (ERD §12.4). Throws typed errors from `errors.ts` on bad input. */
export function survivorBreakdown(a: SurvivorArgs): {
  base: number;
  ageReduced: number;
  cap: number | null;
  amount: number;
} {
  requireFinite(a.deceasedPia, 'deceasedPia');
  if (a.deceasedPia < 0) {
    throw new InvalidProjectionInputError('SS_NEGATIVE_BENEFIT', `deceasedPia must be >= 0 (got ${a.deceasedPia})`);
  }
  requireMonth(a.deathMonth, 'deathMonth');
  requireMonth(a.survivorStartMonth, 'survivorStartMonth');
  const deceasedBirthIdx = birthMonthIndex(a.deceasedBirthYear, a.deceasedBirthMonth);
  const survivorBirthIdx = birthMonthIndex(a.survivorBirthYear, a.survivorBirthMonth);
  const fra = fraMonths(a.deceasedBirthYear);
  const sFra = survivorFraMonths(a.survivorBirthYear);

  if (a.survivorStartMonth < a.deathMonth) {
    throw new InvalidProjectionInputError('SS_INVALID_DEATH', 'survivorStartMonth cannot precede the death month');
  }
  const m = a.survivorStartMonth - survivorBirthIdx;
  if (m < SURVIVOR_EARLIEST_AGE_MONTHS) {
    throw new InvalidProjectionInputError(
      'SS_INVALID_DEATH',
      'survivor benefit cannot start before the survivor is 60y1m (use survivorStartMonth())',
    );
  }

  const claim = a.deceasedClaimMonth;
  if (claim !== null) requireFinite(claim, 'deceasedClaimMonth');
  // A claim month after the death month means the deceased died unclaimed (PRD E42).
  const claimed = claim !== null && claim <= a.deathMonth;
  let base: number;
  let cap: number | null = null;
  if (claimed) {
    const claimAge = claim - deceasedBirthIdx;
    const steady = ownFactorSteady(fra, claimAge); // validates the 62y1m..70y0m window
    base = claimAge < fra ? a.deceasedPia : a.deceasedPia * steady;
    if (claimAge < fra) cap = Math.max(a.deceasedPia * steady, RIB_LIM_FRACTION * a.deceasedPia);
  } else {
    const credits = Math.max(0, Math.min(a.deathMonth - (deceasedBirthIdx + fra), LATEST_CLAIM_OFFSET_MONTHS - fra));
    base = a.deceasedPia * (1 + credits / 150);
  }

  const reduction =
    m >= sFra ? 0 : (MAX_SURVIVOR_REDUCTION * (sFra - m)) / (sFra - AGE_60_MONTHS);
  const ageReduced = base * (1 - reduction);
  return { base, ageReduced, cap, amount: cap === null ? ageReduced : Math.min(ageReduced, cap) };
}
