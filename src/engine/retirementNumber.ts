/**
 * Standalone "Know Your Number" calculation engine.
 *
 * Per `architecture.md`, `src/engine/` holds pure, framework-agnostic calculation
 * functions that validate their own inputs. This module is a sibling of
 * `investmentCalculator.ts` (and, further out, `projection.ts`/`errors.ts`), **not** an
 * extension of them: it is explicitly not wired into `pipeline.ts` or the plan's
 * projection engine — it has no dependency on `PlanAssumptions` and is fully
 * standalone/synchronous, so it defines its own typed-error pair rather than reusing
 * `ProjectionErrorCode`/`InvalidProjectionInputError`. It is shared, unmodified, by both
 * the standalone Know Your Number calculator and the Retirement Spending tab's on-track
 * readout — see ERD: Retirement Spending Goal & Know Your Number Calculator, §5/§6/§12.
 */

export interface RetirementNumberInput {
  currentAge: number;
  retirementAge: number;
  /** Today's dollars, monthly. */
  desiredMonthlySpend: number;
  currentBalance: number;
  annualContribution: number;
  /** Decimal (e.g. 0.025 for 2.5%). Defaults to `0.025`. */
  inflationRate?: number;
  /**
   * Decimal (e.g. 0.04 for 4%). Defaults to `0.04`. Calculator-only — has no bearing on
   * the main plan's own withdrawal logic.
   */
  safeWithdrawalRate?: number;
  /** Decimal (e.g. 0.068 for 6.8%). Defaults to `0.068`. */
  annualReturnRate?: number;
  /** Decimal age. Defaults to `100`, matching this app's `PLANNING_HORIZON_END_AGE`. */
  lifeExpectancy?: number;
}

export type RetirementNumberResult =
  | { status: 'onTrack'; targetBalance: number; projectedBalance: number }
  | { status: 'shortBy'; targetBalance: number; projectedBalance: number; shortfallAmount: number }
  | { status: 'couldRetireEarlier'; targetBalance: number; projectedBalance: number; earliestAge: number };

/**
 * Stable, programmatically-matchable codes for this engine's input-validation failures.
 *
 * Deliberately a separate union from `ProjectionErrorCode` in `errors.ts` — this module is
 * not part of the plan's projection/Monte Carlo engine, so its error space is scoped to
 * itself, mirroring `investmentCalculator.ts`'s own `InvestmentCalculatorErrorCode`.
 *
 * No absolute age-range bounds (e.g. rejecting a negative age) are enforced here — that is
 * a UI `NumberField` bounds concern, not this engine module's (ERD §12).
 */
export type RetirementNumberErrorCode =
  /** Any numeric input field is `NaN`, `Infinity`, `-Infinity`, or not a number. */
  | 'NON_FINITE_INPUT'
  /** `desiredMonthlySpend`, `currentBalance`, or `annualContribution` is negative. */
  | 'NEGATIVE_AMOUNT'
  /**
   * `retirementAge < currentAge`. Note: `retirementAge === currentAge` is the valid
   * already-retired case (a non-empty, single-age search range) — only strictly-before is
   * rejected, since a past retirement age has no meaning for this calculator's forward
   * search.
   */
  | 'RETIREMENT_AGE_NOT_AFTER_CURRENT_AGE'
  /** `lifeExpectancy < retirementAge` — the search range would be empty or reversed. */
  | 'LIFE_EXPECTANCY_BEFORE_RETIREMENT_AGE'
  /** `safeWithdrawalRate <= 0` (a 0% rate makes `targetBalance` infinite) or `> 1`. */
  | 'SAFE_WITHDRAWAL_RATE_OUT_OF_RANGE'
  /** `inflationRate` or `annualReturnRate` is below `-1` (below -100%). */
  | 'RATE_BELOW_NEGATIVE_100_PERCENT';

/**
 * Thrown when caller-supplied input to `calculateRetirementNumber` violates an invariant.
 *
 * Same `.code`/`.message` shape as `InvalidInvestmentInputError`/`InvalidProjectionInputError`,
 * but its own class — this module does not extend either (ERD §6).
 */
export class InvalidRetirementNumberInputError extends Error {
  readonly code: RetirementNumberErrorCode;

  constructor(code: RetirementNumberErrorCode, message: string) {
    super(message);
    this.name = 'InvalidRetirementNumberInputError';
    this.code = code;
  }
}

const DEFAULT_INFLATION_RATE = 0.025;
const DEFAULT_SAFE_WITHDRAWAL_RATE = 0.04;
const DEFAULT_ANNUAL_RETURN_RATE = 0.068;
/** Matches `PLANNING_HORIZON_END_AGE` (`src/ui/hooks/useProjectionState.ts`). */
const DEFAULT_LIFE_EXPECTANCY = 100;

const fail = (code: RetirementNumberErrorCode, message: string): never => {
  throw new InvalidRetirementNumberInputError(code, message);
};

const assertFinite = (value: number, label: string): void => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail('NON_FINITE_INPUT', `${label} must be a finite number, got ${value}.`);
  }
};

/** Validates raw input and returns it with defaults applied. Throws `InvalidRetirementNumberInputError` on any violation. */
const validate = (input: RetirementNumberInput): Required<RetirementNumberInput> => {
  const inflationRate = input.inflationRate ?? DEFAULT_INFLATION_RATE;
  const safeWithdrawalRate = input.safeWithdrawalRate ?? DEFAULT_SAFE_WITHDRAWAL_RATE;
  const annualReturnRate = input.annualReturnRate ?? DEFAULT_ANNUAL_RETURN_RATE;
  const lifeExpectancy = input.lifeExpectancy ?? DEFAULT_LIFE_EXPECTANCY;

  assertFinite(input.currentAge, 'currentAge');
  assertFinite(input.retirementAge, 'retirementAge');
  assertFinite(input.desiredMonthlySpend, 'desiredMonthlySpend');
  assertFinite(input.currentBalance, 'currentBalance');
  assertFinite(input.annualContribution, 'annualContribution');
  assertFinite(inflationRate, 'inflationRate');
  assertFinite(safeWithdrawalRate, 'safeWithdrawalRate');
  assertFinite(annualReturnRate, 'annualReturnRate');
  assertFinite(lifeExpectancy, 'lifeExpectancy');

  if (input.desiredMonthlySpend < 0) {
    fail('NEGATIVE_AMOUNT', `desiredMonthlySpend must be >= 0, got ${input.desiredMonthlySpend}.`);
  }
  if (input.currentBalance < 0) {
    fail('NEGATIVE_AMOUNT', `currentBalance must be >= 0, got ${input.currentBalance}.`);
  }
  if (input.annualContribution < 0) {
    fail('NEGATIVE_AMOUNT', `annualContribution must be >= 0, got ${input.annualContribution}.`);
  }

  if (input.retirementAge < input.currentAge) {
    fail(
      'RETIREMENT_AGE_NOT_AFTER_CURRENT_AGE',
      `retirementAge (${input.retirementAge}) must be >= currentAge (${input.currentAge}).`,
    );
  }

  if (lifeExpectancy < input.retirementAge) {
    fail(
      'LIFE_EXPECTANCY_BEFORE_RETIREMENT_AGE',
      `lifeExpectancy (${lifeExpectancy}) must be >= retirementAge (${input.retirementAge}).`,
    );
  }

  if (safeWithdrawalRate <= 0 || safeWithdrawalRate > 1) {
    fail(
      'SAFE_WITHDRAWAL_RATE_OUT_OF_RANGE',
      `safeWithdrawalRate must be > 0 and <= 1, got ${safeWithdrawalRate}.`,
    );
  }

  if (inflationRate < -1) {
    fail('RATE_BELOW_NEGATIVE_100_PERCENT', `inflationRate must be >= -1, got ${inflationRate}.`);
  }
  if (annualReturnRate < -1) {
    fail('RATE_BELOW_NEGATIVE_100_PERCENT', `annualReturnRate must be >= -1, got ${annualReturnRate}.`);
  }

  return {
    currentAge: input.currentAge,
    retirementAge: input.retirementAge,
    desiredMonthlySpend: input.desiredMonthlySpend,
    currentBalance: input.currentBalance,
    annualContribution: input.annualContribution,
    inflationRate,
    safeWithdrawalRate,
    annualReturnRate,
    lifeExpectancy,
  };
};

/**
 * Computes the household's target balance (the "number") and, given the requested
 * `retirementAge`, whether the household is on track, short, or could retire earlier.
 *
 * Single incremental pass (O(n) in the `currentAge`..`lifeExpectancy` range), since
 * `targetBalance` does not depend on the candidate age being checked: walk the balance
 * forward one year at a time — growth applied to the beginning balance first, then that
 * year's contribution added (`balance = balance * (1 + annualReturnRate) +
 * contributionInYear`), with the flat `annualContribution` inflated by the number of
 * accumulation years already elapsed before being added each year (`annualContribution *
 * (1 + inflationRate) ** yearsFromNow`, `yearsFromNow` 0-indexed from `currentAge`) —
 * recording the first age at which the balance reaches `targetBalance`
 * (`earliestOnTrackAge`) and the balance at the requested `retirementAge` along the way.
 *
 * Classification from `earliestOnTrackAge` vs. `retirementAge`:
 * - Strictly before `retirementAge` → `couldRetireEarlier`, `earliestAge` set to it.
 * - At (or, if never reached, effectively never before) `retirementAge` → `onTrack`.
 * - Never reached by `lifeExpectancy`, or only reached after `retirementAge` → `shortBy`.
 */
export const calculateRetirementNumber = (input: RetirementNumberInput): RetirementNumberResult => {
  const validated = validate(input);
  const { currentAge, retirementAge, desiredMonthlySpend, annualContribution, inflationRate, annualReturnRate, safeWithdrawalRate, lifeExpectancy } =
    validated;

  const targetBalance = (desiredMonthlySpend * 12) / safeWithdrawalRate;

  let balance = validated.currentBalance;
  let earliestOnTrackAge: number | undefined;
  let balanceAtRetirementAge = balance;

  for (let age = currentAge; age <= lifeExpectancy; age += 1) {
    if (earliestOnTrackAge === undefined && balance >= targetBalance) {
      earliestOnTrackAge = age;
    }
    if (age === retirementAge) {
      balanceAtRetirementAge = balance;
    }
    if (age === lifeExpectancy) {
      break;
    }
    const yearsFromNow = age - currentAge;
    const contributionInYear = annualContribution * (1 + inflationRate) ** yearsFromNow;
    balance = balance * (1 + annualReturnRate) + contributionInYear;
  }

  if (earliestOnTrackAge !== undefined && earliestOnTrackAge < retirementAge) {
    return {
      status: 'couldRetireEarlier',
      targetBalance,
      projectedBalance: balanceAtRetirementAge,
      earliestAge: earliestOnTrackAge,
    };
  }

  if (earliestOnTrackAge !== undefined && earliestOnTrackAge <= retirementAge) {
    return { status: 'onTrack', targetBalance, projectedBalance: balanceAtRetirementAge };
  }

  return {
    status: 'shortBy',
    targetBalance,
    projectedBalance: balanceAtRetirementAge,
    shortfallAmount: targetBalance - balanceAtRetirementAge,
  };
};
