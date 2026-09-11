/**
 * Typed error contract for the projection engine.
 *
 * Per `architecture.md`, `src/engine/` does not trust its caller: it validates its own
 * inputs at a single boundary before any fold runs, and throws rather than returning
 * null or an error object. See ERD §6 for the full condition table.
 */

/**
 * Stable, programmatically-matchable codes for engine input-validation failures.
 *
 * Extension point: this union is deliberately open to additions. Story 2's allocation
 * codes (`ALLOCATION_SUM_INVALID`, `ALLOCATION_ZERO_WEIGHT`) landed with the Monte Carlo
 * ticket by adding members here — no change to `InvalidProjectionInputError` itself.
 *
 * Note: `retirementAge <= currentAge` is deliberately absent. That is the valid
 * "already retired" scenario (Story 1 PRD, Edge Cases), not an error.
 */
export type ProjectionErrorCode =
  /** `currentAge > planningHorizonEndAge` — the one-row-per-year loop bound would be reversed. */
  | 'CURRENT_AGE_EXCEEDS_HORIZON'
  /**
   * A Monte Carlo allocation's `stocksPercent + bondsPercent` is not 100.
   *
   * Compared with a `1e-9` epsilon rather than exact equality: a legitimate non-integer
   * split such as 33.33/66.67 sums to 100.00000000000001 in IEEE-754 (ERD §6).
   */
  | 'ALLOCATION_SUM_INVALID'
  /**
   * A Monte Carlo allocation puts negative weight on stocks or on bonds. A single-asset
   * portfolio (0% or 100% stocks) is allowed (FIN-59) — `blendedPortfolioReturn` is a plain
   * weighted sum with no division by either weight, so an all-stock or all-bond split is
   * safe to simulate. Only a negative weight is rejected, since that isn't a real portfolio.
   */
  | 'ALLOCATION_ZERO_WEIGHT'
  /**
   * A Monte Carlo run was asked for a path count that is not a positive whole number.
   *
   * Zero or negative paths describe no simulation at all, and a fractional count runs
   * `Math.floor(count)` paths while reporting the fraction back in `meta` (FIN-17 review).
   */
  | 'SIMULATION_COUNT_INVALID'
  /** Any numeric input field is `NaN`, `Infinity`, `-Infinity`, or not a number. */
  | 'NON_FINITE_INPUT'
  /**
   * `currentAge`, `retirementAge`, or `planningHorizonEndAge` is negative.
   *
   * The federal tax engine (`src/engine/tax/`) reuses this code for `people[i].age < 0`
   * (ERD §7) — a taxpayer's age at year end is the same "negative age" invariant, not a
   * distinct condition.
   */
  | 'NEGATIVE_AGE'
  /**
   * `initialBalance < 0`. Scoped to the input boundary only — a *computed* balance is
   * allowed to go negative mid-projection, which is a legitimate plan-failure outcome.
   */
  | 'NEGATIVE_BALANCE_INPUT'
  /**
   * `currentAnnualIncome < 0`.
   *
   * The federal tax engine (`src/engine/tax/`) reuses this code for `ordinaryIncome < 0`,
   * `preferentialIncome < 0`, or any `people[i].earnedIncome < 0` (ERD §7) — same "income
   * cannot be negative" invariant at a different input boundary.
   */
  | 'NEGATIVE_INCOME'
  /**
   * `annualReturnRate`, `inflationRate`, or `annualRaiseRate` is below -1. Below -100%
   * flips the sign of balance/income through the engine's `x (1 + rate)` formulas.
   *
   * The federal tax engine (`src/engine/tax/`) reuses this code for
   * `indexing.chainedCpiU < -1` or `indexing.averageWageIndex < -1` (ERD §7) — the same
   * sign-flip hazard applies to its compounding formulas.
   */
  | 'RATE_BELOW_NEGATIVE_100_PERCENT'
  /** `annualContributionRate` outside [0, 1]. */
  | 'CONTRIBUTION_RATE_OUT_OF_RANGE'
  /** `withdrawalRateInRetirement` outside [0, 1]. */
  | 'WITHDRAWAL_RATE_OUT_OF_RANGE'
  /**
   * A `recurringCost` `PlanEvent`'s `annualAmount`, `growthRate`, `startAge`, `endAge` (when
   * present), or `recurrenceIntervalYears` (when present) is not a finite number. Checked
   * before every other `recurringCost` condition, per Events & Medicare Cost ERD §6, since the
   * range/comparison checks below would silently pass on `NaN`.
   */
  | 'EVENT_NON_FINITE_NUMERIC_FIELD'
  /** A `recurringCost` event's `startAge < 0`, or `endAge !== undefined && endAge < 0`. */
  | 'EVENT_NEGATIVE_AGE'
  /** A `recurringCost` event's `endAge !== undefined && endAge < startAge`. */
  | 'EVENT_END_BEFORE_START'
  /**
   * A `recurringCost` event's `recurrenceIntervalYears` is present but not a positive whole
   * number (`!Number.isInteger(recurrenceIntervalYears) || recurrenceIntervalYears < 1`).
   */
  | 'EVENT_RECURRENCE_INTERVAL_INVALID'
  /** Two events in the same array share an `id` — would make `EventCostEntry` lookups ambiguous. */
  | 'EVENT_DUPLICATE_ID'
  /**
   * A `recurringCost` event's `growthRate < -1`, same rationale as
   * `RATE_BELOW_NEGATIVE_100_PERCENT`.
   */
  | 'EVENT_GROWTH_RATE_BELOW_NEGATIVE_100_PERCENT'
  /** The federal tax engine's `FederalTaxInput.year` is not an integer (ERD §7). */
  | 'TAX_YEAR_NOT_INTEGER'
  /** The federal tax engine's `FederalTaxInput.year` is outside `[2026, 2125]` inclusive (ERD
   * §7). Out-of-range years throw rather than clamp — see the doc comment on
   * `FederalTaxInput.year`. */
  | 'TAX_YEAR_OUT_OF_RANGE'
  /** The federal tax engine's `FederalTaxInput.filingStatus` is not one of `'single' | 'mfj' |
   * 'mfs' | 'hoh'` (ERD §7). */
  | 'TAX_FILING_STATUS_UNKNOWN'
  /**
   * The federal tax engine's `FederalTaxInput.people` is empty, or its length disagrees with
   * `filingStatus` (`'mfj'` needs exactly 2; `'single'`, `'mfs'`, and `'hoh'` need exactly 1),
   * or `people` is not an array at all (ERD §7, round-1 correction).
   */
  | 'TAX_FILING_STATUS_PEOPLE_MISMATCH'
  /**
   * The federal tax engine's `sum(people[i].earnedIncome)` exceeds `ordinaryIncome` (compared
   * with a `1e-9` epsilon), which cannot happen if `earnedIncome` is genuinely a FICA-able
   * subset tag of `ordinaryIncome` rather than an additional amount (ERD §7, §4.1).
   */
  | 'TAX_EARNED_INCOME_EXCEEDS_ORDINARY'
  /**
   * The federal tax engine was asked to compute MFS preferential (long-term capital gain /
   * qualified dividend) tax, but the MFS preferential bracket thresholds could not be sourced
   * from a primary document — `ResolvedYearTables.preferentialLadder` is `undefined`. Fires
   * only when `filingStatus === 'mfs'` and `preferentialIncome > 0` (ERD §7). Never a guessed
   * half-of-MFJ ladder.
   */
  | 'TAX_MFS_PREFERENTIAL_UNSUPPORTED'
  /**
   * The federal tax engine's `FederalTaxInput.filingStatus` is one of the four valid statuses,
   * but this build has no verified ORDINARY bracket table for it against a primary source — the
   * status is absent from `TAX_TABLES` and listed in `UNSUPPORTED_FILING_STATUSES` (ERD §7,
   * round-3 correction). Distinct from `TAX_FILING_STATUS_UNKNOWN`: that code means the value
   * isn't one of the four at all (a caller bug); this one means the value is valid but this
   * build cannot compute for it (a property of the build). When a status could hit both this
   * and `TAX_MFS_PREFERENTIAL_UNSUPPORTED`, this code fires first.
   */
  | 'TAX_FILING_STATUS_UNVERIFIED';

/**
 * Thrown when caller-supplied engine input violates an invariant.
 *
 * Carries a stable `.code` for programmatic handling alongside a human-readable
 * `.message` for display.
 *
 * Does not survive a Web Worker boundary as an instance: `postMessage`'s structured
 * clone drops the prototype, so a cloned error arrives as a plain `Error` with `.name`
 * of `'Error'` and `.code` of `undefined`. The worker must therefore forward
 * `{ code, message }` as a plain payload and the orchestration layer reconstructs a real
 * instance from it (ERD §7) — never post the caught error object itself.
 */
export class InvalidProjectionInputError extends Error {
  readonly code: ProjectionErrorCode;

  constructor(code: ProjectionErrorCode, message: string) {
    super(message);
    this.name = 'InvalidProjectionInputError';
    this.code = code;
  }
}
