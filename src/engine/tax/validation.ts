/**
 * WP-F: the full §7 input-validation boundary for the federal tax engine.
 *
 * Every INPUT-only check runs here, before any arithmetic (ERD §7, §5.1 step 1). The one check
 * that cannot live here — whether the MFS preferential ladder could be sourced — depends on
 * `ResolvedYearTables`, not on `input` alone, and lives as `assertPreferentialLadderAvailable` in
 * `federalTax.ts` instead (ERD §7, round-1 correction (a)).
 *
 * Reuses the existing open `ProjectionErrorCode` union and `InvalidProjectionInputError` — no
 * parallel error type (`errors.ts:12-14` explicitly invites this; Story 2's allocation codes set
 * the precedent).
 */

import { InvalidProjectionInputError } from '../errors';
import type { FederalTaxInput, FilingStatus, IndexingRates, TaxPayer } from './types';

const EPSILON = 1e-9;

const EXPECTED_PEOPLE_COUNT: Record<FilingStatus, number> = {
  single: 1,
  mfj: 2,
  mfs: 1,
  hoh: 1,
};

function assertFinite(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new InvalidProjectionInputError(
      'NON_FINITE_INPUT',
      `${field} must be a finite number, received ${String(value)}.`,
    );
  }
}

/**
 * Validates every INPUT-only condition of ERD §7. Throws `InvalidProjectionInputError` on the
 * first violation found, in the order below (which matches the ERD's table order, with the
 * "not an object at all" guards for `people`/`indexing` running first per the round-1
 * correction).
 */
export function validateFederalTaxInput(input: FederalTaxInput): void {
  // `people` must be an array before anything below can index into it.
  if (!Array.isArray(input.people)) {
    throw new InvalidProjectionInputError(
      'TAX_FILING_STATUS_PEOPLE_MISMATCH',
      `people must be an array of 1 or 2 taxpayers, received ${String(input.people)}.`,
    );
  }

  // `indexing` must be an object carrying both numeric fields before field access below.
  if (
    input.indexing === undefined ||
    input.indexing === null ||
    typeof input.indexing !== 'object'
  ) {
    throw new InvalidProjectionInputError(
      'NON_FINITE_INPUT',
      `indexing.chainedCpiU must be a finite number, received ${String(
        (input.indexing as IndexingRates | undefined)?.chainedCpiU,
      )}.`,
    );
  }

  assertFinite(input.year, 'year');
  assertFinite(input.ordinaryIncome, 'ordinaryIncome');
  assertFinite(input.preferentialIncome, 'preferentialIncome');
  assertFinite(input.indexing.chainedCpiU, 'indexing.chainedCpiU');
  assertFinite(input.indexing.averageWageIndex, 'indexing.averageWageIndex');

  input.people.forEach((person: TaxPayer, i: number) => {
    assertFinite(person.earnedIncome, `people[${i}].earnedIncome`);
    assertFinite(person.age, `people[${i}].age`);
  });

  if (!Number.isInteger(input.year)) {
    throw new InvalidProjectionInputError(
      'TAX_YEAR_NOT_INTEGER',
      `year must be a whole number, received ${input.year}.`,
    );
  }

  if (input.year < 2026 || input.year > 2125) {
    throw new InvalidProjectionInputError(
      'TAX_YEAR_OUT_OF_RANGE',
      `year must be between 2026 and 2125 inclusive, received ${input.year}.`,
    );
  }

  const validStatuses: FilingStatus[] = ['single', 'mfj', 'mfs', 'hoh'];
  if (!validStatuses.includes(input.filingStatus)) {
    throw new InvalidProjectionInputError(
      'TAX_FILING_STATUS_UNKNOWN',
      `filingStatus must be one of single, mfj, mfs, hoh; received "${String(input.filingStatus)}".`,
    );
  }

  const expectedCount = EXPECTED_PEOPLE_COUNT[input.filingStatus];
  if (input.people.length !== expectedCount) {
    throw new InvalidProjectionInputError(
      'TAX_FILING_STATUS_PEOPLE_MISMATCH',
      `filingStatus "${input.filingStatus}" requires exactly ${expectedCount} people, received ${input.people.length}.`,
    );
  }

  if (input.ordinaryIncome < 0) {
    throw new InvalidProjectionInputError(
      'NEGATIVE_INCOME',
      `ordinaryIncome must not be negative, received ${input.ordinaryIncome}.`,
    );
  }

  if (input.preferentialIncome < 0) {
    throw new InvalidProjectionInputError(
      'NEGATIVE_INCOME',
      `preferentialIncome must not be negative, received ${input.preferentialIncome}.`,
    );
  }

  input.people.forEach((person: TaxPayer, i: number) => {
    if (person.earnedIncome < 0) {
      throw new InvalidProjectionInputError(
        'NEGATIVE_INCOME',
        `people[${i}].earnedIncome must not be negative, received ${person.earnedIncome}.`,
      );
    }
  });

  const totalEarnedIncome = input.people.reduce((sum, p) => sum + p.earnedIncome, 0);
  if (totalEarnedIncome - input.ordinaryIncome > EPSILON) {
    throw new InvalidProjectionInputError(
      'TAX_EARNED_INCOME_EXCEEDS_ORDINARY',
      `the sum of people[].earnedIncome must not exceed ordinaryIncome (earned income is a subset tag, not an additional amount), received ${totalEarnedIncome} against ${input.ordinaryIncome}.`,
    );
  }

  input.people.forEach((person: TaxPayer, i: number) => {
    if (person.age < 0) {
      throw new InvalidProjectionInputError(
        'NEGATIVE_AGE',
        `people[${i}].age must not be negative, received ${person.age}.`,
      );
    }
  });

  if (input.indexing.chainedCpiU < -1) {
    throw new InvalidProjectionInputError(
      'RATE_BELOW_NEGATIVE_100_PERCENT',
      `indexing.chainedCpiU must not be below -1, received ${input.indexing.chainedCpiU}.`,
    );
  }

  if (input.indexing.averageWageIndex < -1) {
    throw new InvalidProjectionInputError(
      'RATE_BELOW_NEGATIVE_100_PERCENT',
      `indexing.averageWageIndex must not be below -1, received ${input.indexing.averageWageIndex}.`,
    );
  }
}
