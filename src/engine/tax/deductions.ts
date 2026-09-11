/**
 * WP-D: standard deduction + OBBBA senior bonus (ERD §5.2).
 *
 * Pure calculation, no React, no I/O. Value-indifferent about where `ResolvedYearTables`'
 * numbers come from — that's `tables.ts` (WP-C), not imported here.
 */

import type { DeductionBreakdown, FilingStatus, ResolvedYearTables, TaxPayer } from './types';

/**
 * `true` for 2025-2028 inclusive. Note the bound is inclusive-2028, NOT exclusive-2029 (a
 * mistake some third-party tools make per the ERD) — 2028 is the last TRUE year.
 *
 * 2025 is below the engine's public year range (2026-2125), so it's only reachable by testing
 * this helper directly — that's intentional, not dead code.
 */
export function seniorBonusAppliesInYear(year: number): boolean {
  return year >= 2025 && year <= 2028;
}

/**
 * v1's MAGI: gross ordinary + gross preferential income, because every addback that would
 * separate MAGI from AGI (taxable Social Security, tax-exempt interest, foreign income
 * exclusion) is an explicit non-goal. Named and exported so `federalTax.ts` (WP-F) and this
 * module share one definition of "what is MAGI" rather than each reinventing it.
 */
export function magiForV1(ordinaryIncome: number, preferentialIncome: number): number {
  return ordinaryIncome + preferentialIncome;
}

/**
 * Computes the standard deduction and OBBBA senior bonus for one household.
 *
 * Signature choice: takes `ordinaryIncome` and `preferentialIncome` directly (rather than a
 * pre-computed MAGI number) and derives MAGI internally via `magiForV1`. This keeps "what is
 * MAGI" defined in exactly one place in this module (used here and exported for callers that
 * need to echo it elsewhere, e.g. `FederalTaxResult.magi`), and keeps this function testable
 * in isolation with the same raw inputs `FederalTaxInput` already carries — `federalTax.ts`
 * (WP-F) can call this with the same `ordinaryIncome`/`preferentialIncome` it already has on
 * hand, with no separate MAGI-computation step for callers to get wrong or duplicate.
 *
 * Per ERD §5.2, the senior bonus phase-out is applied PER QUALIFYING TAXPAYER independently
 * against the SAME joint MAGI — never against a pooled/doubled amount. See the two-qualifying-
 * person tests in deductions.test.ts for the worked regression example.
 */
export function computeDeductions(
  tables: ResolvedYearTables,
  people: readonly TaxPayer[],
  filingStatus: FilingStatus,
  year: number,
  ordinaryIncome: number,
  preferentialIncome: number,
): DeductionBreakdown {
  const qualifying = people.filter((p) => p.age >= 65).length;

  const base = tables.standardDeductionBase;
  const ageAddition = tables.ageAdditionPerQualifyingPerson * qualifying;
  const standardDeduction = base + ageAddition;

  let seniorBonusDeduction = 0;
  if (seniorBonusAppliesInYear(year) && filingStatus !== 'mfs' && qualifying > 0) {
    const magi = magiForV1(ordinaryIncome, preferentialIncome);
    const excess = Math.max(0, magi - tables.seniorBonus.phaseOutStart);
    const perPerson = Math.max(
      0,
      tables.seniorBonus.amountPerQualifyingPerson - tables.seniorBonus.phaseOutRate * excess,
    );
    seniorBonusDeduction = perPerson * qualifying;
  }

  const total = standardDeduction + seniorBonusDeduction;

  return { base, ageAddition, standardDeduction, seniorBonusDeduction, total };
}
