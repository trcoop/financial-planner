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
