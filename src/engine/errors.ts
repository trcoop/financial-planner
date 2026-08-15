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
 * codes (`ALLOCATION_SUM_INVALID`, `ALLOCATION_ZERO_WEIGHT`) land with the Monte Carlo
 * ticket by adding members here — no change to `InvalidProjectionInputError` itself.
 *
 * Note: `retirementAge <= currentAge` is deliberately absent. That is the valid
 * "already retired" scenario (Story 1 PRD, Edge Cases), not an error.
 */
export type ProjectionErrorCode =
  /** `currentAge > planningHorizonEndAge` — the one-row-per-year loop bound would be reversed. */
  | 'CURRENT_AGE_EXCEEDS_HORIZON'
  /** Any numeric input field is `NaN`, `Infinity`, `-Infinity`, or not a number. */
  | 'NON_FINITE_INPUT'
  /** `currentAge`, `retirementAge`, or `planningHorizonEndAge` is negative. */
  | 'NEGATIVE_AGE'
  /**
   * `initialBalance < 0`. Scoped to the input boundary only — a *computed* balance is
   * allowed to go negative mid-projection, which is a legitimate plan-failure outcome.
   */
  | 'NEGATIVE_BALANCE_INPUT'
  /** `currentAnnualIncome < 0`. */
  | 'NEGATIVE_INCOME'
  /**
   * `annualReturnRate`, `inflationRate`, or `annualRaiseRate` is below -1. Below -100%
   * flips the sign of balance/income through the engine's `x (1 + rate)` formulas.
   */
  | 'RATE_BELOW_NEGATIVE_100_PERCENT'
  /** `annualContributionRate` outside [0, 1]. */
  | 'CONTRIBUTION_RATE_OUT_OF_RANGE'
  /** `withdrawalRateInRetirement` outside [0, 1]. */
  | 'WITHDRAWAL_RATE_OUT_OF_RANGE';

/**
 * Thrown when caller-supplied engine input violates an invariant.
 *
 * Carries a stable `.code` for programmatic handling alongside a human-readable
 * `.message` for display. Both survive the Web Worker boundary: `postMessage`'s
 * structured clone does not preserve custom prototypes, so the worker orchestration
 * layer forwards `{ code, message }` and reconstructs a real instance from them
 * (ERD §7).
 */
export class InvalidProjectionInputError extends Error {
  readonly code: ProjectionErrorCode;

  constructor(code: ProjectionErrorCode, message: string) {
    super(message);
    this.name = 'InvalidProjectionInputError';
    this.code = code;
  }
}
