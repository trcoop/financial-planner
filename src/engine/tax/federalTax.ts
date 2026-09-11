/**
 * WP-F: the orchestrator (ERD §5.1). Composes every other work package into
 * `computeFederalTax`, including the finite-difference marginal rate.
 */

import { InvalidProjectionInputError } from '../errors';
import { bandRateAt, occupyLadder } from './brackets';
import { computeDeductions, magiForV1 } from './deductions';
import { computeFica } from './fica';
import { allocateRounding, roundHalfUp } from './rounding';
import { resolveTables } from './tables';
import { validateFederalTaxInput } from './validation';
import type { BracketOccupancy, FederalTaxInput, FederalTaxResult, ResolvedYearTables } from './types';

/**
 * Guard for the one condition that cannot live in `validateFederalTaxInput` (ERD §7, round-1
 * correction (a)): whether the MFS preferential ladder could be sourced is a property of
 * `ResolvedYearTables`, not of `input` alone. Runs inside `computeCore` immediately after
 * `resolveTables` — and therefore runs twice per `computeFederalTax` call (once per
 * finite-difference pass), idempotently and cheaply.
 *
 * Exported (not just called internally) precisely so it is unit-testable against a hand-built
 * `ResolvedYearTables` literal, independent of whatever `tables.ts`/WP-0 actually ships for MFS
 * (ERD §7, round-2 clarification).
 */
export function assertPreferentialLadderAvailable(
  tables: ResolvedYearTables,
  input: FederalTaxInput,
): void {
  if (
    input.filingStatus === 'mfs' &&
    input.preferentialIncome > 0 &&
    tables.preferentialLadder === undefined
  ) {
    throw new InvalidProjectionInputError(
      'TAX_MFS_PREFERENTIAL_UNSUPPORTED',
      `MFS preferential (long-term capital gain / qualified dividend) thresholds are not published in the sources this engine was built from; computeFederalTax refuses to guess. Received preferentialIncome ${input.preferentialIncome} with filingStatus "mfs".`,
    );
  }
}

interface CoreResult {
  result: Omit<FederalTaxResult, 'effectiveMarginalRate'>;
  /** UNROUNDED total tax before credits — the finite-difference basis (ERD §5.6). Never
   * rounded, since rounding quantises the derivative into 0/1 dollar steps and destroys the
   * 1.06/1.12 senior-bonus multipliers. */
  unroundedTaxBeforeCredits: number;
}

/**
 * The internal, non-recursive computation (ERD §5.1 steps 1-2, §5.2-§5.5, §5.7). Does NOT
 * validate `input` (the caller, `computeFederalTax`, already did at step 1 and this is called a
 * second time on an engine-internal bumped input that is provably still valid) and does NOT
 * compute `effectiveMarginalRate` (that requires calling this function twice, which must happen
 * exactly once, in `computeFederalTax`, never recursively from here).
 */
function computeCore(input: FederalTaxInput): CoreResult {
  const tables = resolveTables(input.year, input.filingStatus, input.indexing);
  assertPreferentialLadderAvailable(tables, input);

  const grossOrdinaryIncome = input.ordinaryIncome;
  const grossPreferentialIncome = input.preferentialIncome;
  const magi = magiForV1(grossOrdinaryIncome, grossPreferentialIncome);

  const deduction = computeDeductions(
    tables,
    input.people,
    input.filingStatus,
    input.year,
    grossOrdinaryIncome,
    grossPreferentialIncome,
  );

  // §5.3: the deduction applies against ordinary income first. UNCLAMPED — the negative case
  // (unused deduction widening the 0% preferential band) is the entire point of the shift.
  const shift = grossOrdinaryIncome - deduction.total;
  const taxableOrdinaryIncome = Math.max(0, shift);

  const taxableIncomeTotal = Math.max(0, grossOrdinaryIncome + grossPreferentialIncome - deduction.total);
  const taxablePreferentialIncome = taxableIncomeTotal - taxableOrdinaryIncome;
  const taxableIncome = taxableOrdinaryIncome + taxablePreferentialIncome;

  const ordinaryBrackets: readonly BracketOccupancy[] = occupyLadder(tables.ordinaryLadder, taxableOrdinaryIncome, 0);
  const preferentialBrackets: readonly BracketOccupancy[] =
    tables.preferentialLadder === undefined
      ? []
      : occupyLadder(tables.preferentialLadder, grossPreferentialIncome, shift);

  const unroundedOrdinaryTax = ordinaryBrackets.reduce((sum, b) => sum + b.taxFromThisBracket, 0);
  const unroundedPreferentialTax = preferentialBrackets.reduce((sum, b) => sum + b.taxFromThisBracket, 0);
  const unroundedTaxBeforeCredits = unroundedOrdinaryTax + unroundedPreferentialTax;

  const taxBeforeCredits = roundHalfUp(unroundedTaxBeforeCredits);
  const [ordinaryTax, preferentialTax] = allocateRounding(
    [unroundedOrdinaryTax, unroundedPreferentialTax],
    taxBeforeCredits,
  );

  const credits = 0;
  const taxOwed = taxBeforeCredits - credits;

  const fica = computeFica(tables.fica, input.people);

  const grossIncome = grossOrdinaryIncome + grossPreferentialIncome;
  const effectiveRate = grossIncome === 0 ? 0 : taxOwed / grossIncome;
  const effectiveRateIncludingFica = grossIncome === 0 ? 0 : (taxOwed + fica.total) / grossIncome;

  const ordinaryBracketRate = bandRateAt(tables.ordinaryLadder, taxableOrdinaryIncome);

  return {
    result: {
      year: input.year,
      filingStatus: input.filingStatus,
      grossOrdinaryIncome,
      grossPreferentialIncome,
      magi,
      deduction,
      taxableOrdinaryIncome,
      taxablePreferentialIncome,
      taxableIncome,
      ordinaryBrackets,
      preferentialBrackets,
      ordinaryTax,
      preferentialTax,
      taxBeforeCredits,
      credits,
      taxOwed,
      fica,
      effectiveRate,
      effectiveRateIncludingFica,
      ordinaryBracketRate,
    },
    unroundedTaxBeforeCredits,
  };
}

/**
 * Public entry point (ERD §5.1). Validates, resolves tables, assembles deductions, computes the
 * preferential-ladder shift, occupies both ladders, computes FICA, allocates rounding, and
 * computes both rate pairs — including `effectiveMarginalRate` by finite difference (§5.6),
 * which requires exactly one extra call to `computeCore` with `ordinaryIncome + 1`.
 *
 * `people[].earnedIncome` is NOT bumped for the finite-difference call: this measures income
 * tax only, so FICA is excluded by construction, and the earned-income subset invariant still
 * holds because ordinary income only rises.
 */
export function computeFederalTax(input: FederalTaxInput): FederalTaxResult {
  validateFederalTaxInput(input);

  const core = computeCore(input);
  const bumped = computeCore({ ...input, ordinaryIncome: input.ordinaryIncome + 1 });
  const effectiveMarginalRate = bumped.unroundedTaxBeforeCredits - core.unroundedTaxBeforeCredits;

  return { ...core.result, effectiveMarginalRate };
}
