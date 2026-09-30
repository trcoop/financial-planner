/**
 * Social Security contract types (ERD §12.1 + §12.25.1 FINAL). Units: MONEY = US dollars,
 * unrounded nominal doubles; RATE = decimal; quantities are integer months; every `MonthIndex`
 * is calendar (`year*12 + (month-1)`), never a projection offset.
 */
import type { AsOf, MonthIndex } from '../age';
import type { ProjectionErrorCode } from '../errors';

// `AsOf` and `MonthIndex` are defined in `../age` (neutral home); re-exported only.
export type { AsOf, MonthIndex };

/** Every `SS_`-prefixed member of `ProjectionErrorCode` (excludes `TAX_` and generic codes). */
export type SsErrorCode = Extract<ProjectionErrorCode, `SS_${string}`>;

/** Exactly one source per person: the union makes "neither/both" unrepresentable. */
export type SsBenefitSource =
  /** FRA monthly benefit, own record only, today's $ as of asOf, >= 0 ($0 valid). */
  | { kind: 'pia'; pia: number }
  /** Gross own-benefit check paid in asOf.year (PRD E7), >= 0. */
  | { kind: 'collecting'; check: number; sinceMonth: MonthIndex };

/** No birthDay (PRD P5). */
export interface SsPerson {
  birthYear: number;
  birthMonth: number;
  benefit: SsBenefitSource;
}

export interface SsInputs {
  asOf: AsOf;
  /** RATE, 0..0.20. */
  colaRate: number;
  /** RATE 0..0.25; `null` = growth toggle OFF (0 is a legal ON value). */
  growthRate: number | null;
  people: [SsPerson] | [SsPerson, SsPerson];
  /**
   * Calendar month each person starts their OWN benefit. `null` iff `benefit.kind === 'collecting'`
   * (then `sinceMonth` is the start); a mismatch throws `SS_INVALID_ALREADY_COLLECTING`.
   */
  claimMonth: (MonthIndex | null)[];
  /** Death age in YEARS; engine derives `deathMonth = birthIdx + round(deathAgeYears*12)`. `null` = none. */
  deathAgeYears?: (number | null)[];
  /** Last calendar year of output (calculator: last death year; plan: horizon end). Required. */
  endYear: number;
}

/** MONEY, nominal, gross, per calendar month. */
export interface SsMonth {
  own: number;
  spousal: number;
  survivor: number;
}

export interface SsAnnualRow {
  year: number;
  perPerson: { own: number; spousal: number; survivor: number; total: number }[];
  household: number;
}

export type SsStartKind = 'own' | 'spousal' | 'survivor';

export interface SsResult {
  /** `asOf.year * 12` (January of asOf.year). */
  firstMonth: MonthIndex;
  /** `endYear * 12 + 11`. */
  lastMonth: MonthIndex;
  /** `[personIndex][month - firstMonth]`, dense `firstMonth..lastMonth` inclusive. */
  series: SsMonth[][];
  /** Each year = sum of its 12 series months; callers never re-sum. */
  annual: SsAnnualRow[];
  /** `deferredTo60` only on survivor (PRD E41 note). */
  starts: { personIndex: number; kind: SsStartKind; month: MonthIndex; deferredTo60?: boolean }[];
  deathMonths: (MonthIndex | null)[];
}

/** One entry per NON-collecting person; months ascending, unique, inside the legal window. */
export interface TopClaimsAxis {
  personIndex: number;
  months: MonthIndex[];
}

/** `claimMonths[i]` is null iff person i is collecting; `total` is unrounded. */
export interface TopClaim {
  claimMonths: (MonthIndex | null)[];
  total: number;
}

/** Plan-path schedule; `nominalAnnual` is whole dollars (ERD §12.3). */
export type SsAnnualSchedule = { year: number; personIndex: number; nominalAnnual: number }[];

/**
 * Arguments to `survivorBreakdown` (ERD §12.4). PROVISIONAL shape: the ERD names the type but
 * never spells its fields; WP-D owns the final field list and may refine this type in place
 * (the barrel already exports the name, so the change is local to this file).
 */
export interface SurvivorArgs {
  deceasedPia: number;
  deceasedBirthYear: number;
  deceasedBirthMonth: number;
  /** Deceased's own claim month; `null` = died unclaimed (PRD E42). */
  deceasedClaimMonth: MonthIndex | null;
  deathMonth: MonthIndex;
  survivorBirthYear: number;
  survivorBirthMonth: number;
  survivorStartMonth: MonthIndex;
}
