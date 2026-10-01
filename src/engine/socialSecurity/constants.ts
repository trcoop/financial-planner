import { InvalidProjectionInputError } from '../errors';

/** Default death age in years: age 62 + (20.29 male + 23.08 female)/2 (PRD E18, SSA 2023 period table). */
export const DEFAULT_DEATH_AGE_YEARS = 83.685;

/**
 * `max(83.685, currentAgeYears + 1)`, unrounded (ERD §12.21, §12.25.1). The floor keeps the
 * default from landing before the asOf month for anyone 84+.
 */
export function defaultDeathAgeYears(currentAgeYears: number): number {
  if (!Number.isFinite(currentAgeYears)) {
    throw new InvalidProjectionInputError(
      'NON_FINITE_INPUT',
      `currentAgeYears must be a finite number (got ${currentAgeYears})`,
    );
  }
  return Math.max(DEFAULT_DEATH_AGE_YEARS, currentAgeYears + 1);
}

/**
 * Full Retirement Age in months by birth year (ERD §4). 1941/1942 exist for the survivor-FRA
 * lookup only (`survivorFraMonths(Y) = fra(Y - 2)`, §12.5); births before 1943 remain
 * `SS_UNSUPPORTED_BIRTH_YEAR` for own/spousal benefits.
 */
export const FRA_MONTHS_BY_BIRTH_YEAR: Readonly<Record<number, number>> = {
  1941: 788,
  1942: 790,
  1943: 792,
  1944: 792,
  1945: 792,
  1946: 792,
  1947: 792,
  1948: 792,
  1949: 792,
  1950: 792,
  1951: 792,
  1952: 792,
  1953: 792,
  1954: 792,
  1955: 794,
  1956: 796,
  1957: 798,
  1958: 800,
  1959: 802,
  1960: 804,
};

/** FRA in months for every birth year after the last table row (1960+). */
export const FRA_MONTHS_AFTER_TABLE = 804;

/** First birth year supported by the benefit module (ERD §12.7). */
export const MIN_SUPPORTED_BIRTH_YEAR = 1943;

/** Earliest claim: birth month index + 745 (62y1m), ERD §12.1. */
export const EARLIEST_CLAIM_OFFSET_MONTHS = 745;
/** Latest claim: birth month index + 840 (70y0m). */
export const LATEST_CLAIM_OFFSET_MONTHS = 840;

/** Validation bounds (ERD §12.7). */
export const MAX_COLA_RATE = 0.2;
export const MAX_GROWTH_RATE = 0.25;
export const MAX_DEATH_AGE_YEARS = 120;
