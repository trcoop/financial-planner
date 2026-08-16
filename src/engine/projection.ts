/**
 * The deterministic projection (Story 1, Tier 1): the engine's public entry point.
 *
 * Validates its inputs once at the boundary, then folds {@link runPeriod} across every year
 * from `currentAge` through `planningHorizonEndAge`. Pure and synchronous — same inputs
 * always produce the same rows, and nothing the caller passes in is mutated.
 *
 * Kept separate from `pipeline.ts` so the per-period step function stays free of any notion
 * of a horizon: Monte Carlo folds that same step function over its own per-path returns.
 */

import { InvalidProjectionInputError } from './errors';
import { runPeriod } from './pipeline';
import { withdrawFullShortfall, zeroTax } from './strategies';
import type { PeriodState, PlanAssumptions, PlanEvent, ProjectionRow, RunPeriodInput } from './types';

/** Every numeric field of {@link PlanAssumptions}, for the finiteness sweep. */
const NUMERIC_FIELDS = [
  'currentAge',
  'retirementAge',
  'initialBalance',
  'currentAnnualIncome',
  'annualContributionRate',
  'annualRaiseRate',
  'annualReturnRate',
  'inflationRate',
  'withdrawalRateInRetirement',
  'planningHorizonEndAge',
] as const satisfies ReadonlyArray<keyof PlanAssumptions>;

/** Rates that run through the engine's `x * (1 + rate)` formulas. */
const COMPOUNDING_RATE_FIELDS = ['annualReturnRate', 'inflationRate', 'annualRaiseRate'] as const;

/**
 * Rejects any caller-supplied assumptions the projection cannot meaningfully run on.
 *
 * A single up-front pass, before any folding, so a rejected input never yields partial rows
 * (ERD §6). Finiteness is checked across every field first — the range comparisons below
 * would silently pass on `NaN`, which compares false against everything — and the remaining
 * checks throw on the first violation found.
 *
 * Exported because Story 2's `runMonteCarlo` validates the same `PlanAssumptions` at its own
 * boundary and must produce identical codes for identical inputs.
 *
 * Note what is deliberately *absent*: `retirementAge <= currentAge` is the valid
 * already-retired scenario, not an error, and a *computed* balance going negative
 * mid-projection is a legitimate plan-failure outcome. Only `initialBalance` itself is
 * range-checked here.
 *
 * @throws {InvalidProjectionInputError}
 */
export const validatePlanAssumptions = (assumptions: PlanAssumptions): void => {
  for (const field of NUMERIC_FIELDS) {
    const value = assumptions[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new InvalidProjectionInputError(
        'NON_FINITE_INPUT',
        `${field} must be a finite number, received ${String(value)}.`,
      );
    }
  }

  const {
    currentAge,
    retirementAge,
    planningHorizonEndAge,
    initialBalance,
    currentAnnualIncome,
    annualContributionRate,
    withdrawalRateInRetirement,
  } = assumptions;

  if (currentAge < 0 || retirementAge < 0 || planningHorizonEndAge < 0) {
    throw new InvalidProjectionInputError(
      'NEGATIVE_AGE',
      `Ages must not be negative, received currentAge ${currentAge}, retirementAge ${retirementAge}, planningHorizonEndAge ${planningHorizonEndAge}.`,
    );
  }

  if (currentAge > planningHorizonEndAge) {
    throw new InvalidProjectionInputError(
      'CURRENT_AGE_EXCEEDS_HORIZON',
      `currentAge ${currentAge} is past planningHorizonEndAge ${planningHorizonEndAge}, leaving no years to project.`,
    );
  }

  if (initialBalance < 0) {
    throw new InvalidProjectionInputError(
      'NEGATIVE_BALANCE_INPUT',
      `initialBalance must not be negative, received ${initialBalance}.`,
    );
  }

  if (currentAnnualIncome < 0) {
    throw new InvalidProjectionInputError(
      'NEGATIVE_INCOME',
      `currentAnnualIncome must not be negative, received ${currentAnnualIncome}.`,
    );
  }

  for (const field of COMPOUNDING_RATE_FIELDS) {
    if (assumptions[field] < -1) {
      throw new InvalidProjectionInputError(
        'RATE_BELOW_NEGATIVE_100_PERCENT',
        `${field} must not be below -1 (-100%), received ${assumptions[field]}.`,
      );
    }
  }

  if (annualContributionRate < 0 || annualContributionRate > 1) {
    throw new InvalidProjectionInputError(
      'CONTRIBUTION_RATE_OUT_OF_RANGE',
      `annualContributionRate must be between 0 and 1, received ${annualContributionRate}.`,
    );
  }

  if (withdrawalRateInRetirement < 0 || withdrawalRateInRetirement > 1) {
    throw new InvalidProjectionInputError(
      'WITHDRAWAL_RATE_OUT_OF_RANGE',
      `withdrawalRateInRetirement must be between 0 and 1, received ${withdrawalRateInRetirement}.`,
    );
  }
};

/**
 * The state a projection starts from, at year 0 and `currentAge`.
 *
 * The working fields (`beginningBalance`, `investmentReturn`, `annualContribution`,
 * `annualWithdrawal`) are zeroed rather than pre-populated: every one of them is written by
 * the stage that owns it before `recordPeriod` reads it, so a zero here is a placeholder
 * that a broken stage would leave visible in year 0's row rather than mask.
 *
 * Exported for Story 2, whose per-path fold starts from this same state.
 */
export const createInitialPeriodState = (assumptions: PlanAssumptions): PeriodState => ({
  age: assumptions.currentAge,
  year: 0,
  balance: assumptions.initialBalance,
  priorIncome: 0,
  priorWithdrawal: null,
  rows: [],
  beginningBalance: 0,
  investmentReturn: 0,
  annualContribution: 0,
  annualWithdrawal: 0,
});

/** Moves a completed period on to the next year. */
const advance = (state: PeriodState): PeriodState => ({ ...state, age: state.age + 1, year: state.year + 1 });

/**
 * Projects wealth year by year from `currentAge` through `planningHorizonEndAge`.
 *
 * Row count is inclusive of both endpoints — age 35 through 100 is 66 rows, `year` 0 through
 * 65. Balances are plain IEEE-754 floats with no rounding at any step; cent-level formatting
 * is the UI's job (ERD §5).
 *
 * @throws {InvalidProjectionInputError} if any assumption violates the contract in §6.
 */
export const runProjection = (assumptions: PlanAssumptions, events: PlanEvent[] = []): ProjectionRow[] => {
  validatePlanAssumptions(assumptions);

  const input: RunPeriodInput = {
    events,
    assumptions,
    // The deterministic case: every period draws the same fixed rate. Monte Carlo varies
    // this per period through the identical pipeline.
    returnForPeriod: assumptions.annualReturnRate,
    withdrawalStrategy: withdrawFullShortfall,
    taxCalculator: zeroTax,
  };

  let state = createInitialPeriodState(assumptions);
  while (state.age <= assumptions.planningHorizonEndAge) {
    state = advance(runPeriod(state, input));
  }

  return state.rows;
};
