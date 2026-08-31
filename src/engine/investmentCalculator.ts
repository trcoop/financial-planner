/**
 * Standalone investment-growth calculator engine.
 *
 * Per `architecture.md`, `src/engine/` holds pure, framework-agnostic calculation
 * functions that validate their own inputs. This module is a sibling of
 * `projection.ts`/`errors.ts`, **not** an extension of them: it is explicitly not
 * wired into `pipeline.ts` or the plan's projection engine (PRD Non-Goal #4), so it
 * defines its own typed-error pair rather than reusing `ProjectionErrorCode`/
 * `InvalidProjectionInputError`. See ERD: Investment Calculator §2.
 */

/** How often growth compounds. */
export type CompoundingFrequency = 'annually' | 'semiAnnually' | 'quarterly' | 'monthly' | 'daily';

/** How often contributions are made. */
export type ContributionFrequency = 'monthly' | 'annually';

/** Whether a contribution is credited before or after that compounding period's growth. */
export type ContributionTiming = 'start' | 'end';

export interface InvestmentProjectionInput {
  /** Balance at year 0. Bounds: 0–100,000,000. */
  startingAmount: number;
  /** Hypothetical annual growth rate, as a percentage (e.g. 7 for 7%). Bounds: -10–30. */
  annualGrowthRate: number;
  /** Compounding granularity. Defaults to `'annually'`. */
  compoundingFrequency?: CompoundingFrequency;
  /** Amount contributed each contribution period. Bounds: 0–1,000,000. 0 = no contributions. */
  contributionAmount: number;
  /** How often contributions are made. */
  contributionFrequency: ContributionFrequency;
  /** Whether each compounding period's contribution bucket is credited before or after growth. Defaults to `'end'`. */
  contributionTiming?: ContributionTiming;
  /** Projection horizon in whole years. Bounds: 1–100, integer-only. */
  years: number;
}

/** One row of the year-by-year projection, captured at year-end boundaries. */
export interface YearRow {
  year: number;
  balance: number;
}

export interface InvestmentProjectionResult {
  finalBalance: number;
  totalContributions: number;
  /** `finalBalance - startingAmount - totalContributions`. */
  totalGrowth: number;
  /** One row per year of the horizon, plus one for year 0 (`rows.length === years + 1`). */
  rows: YearRow[];
}

/**
 * Stable, programmatically-matchable codes for this engine's input-validation failures.
 *
 * Deliberately a separate union from `ProjectionErrorCode` in `errors.ts` — this
 * calculator is not part of the plan's projection/Monte Carlo engine, so its error
 * space is scoped to itself (ERD §2).
 */
export type InvestmentCalculatorErrorCode =
  /** Any numeric input field is `NaN`, `Infinity`, `-Infinity`, or not a number. */
  | 'INVESTMENT_NON_FINITE_INPUT'
  /** `startingAmount < 0`. */
  | 'INVESTMENT_NEGATIVE_STARTING_AMOUNT'
  /** `startingAmount > 100_000_000`. */
  | 'INVESTMENT_STARTING_AMOUNT_TOO_LARGE'
  /** `annualGrowthRate` outside [-10, 30] (percent). */
  | 'INVESTMENT_GROWTH_RATE_OUT_OF_RANGE'
  /** `contributionAmount < 0`. */
  | 'INVESTMENT_NEGATIVE_CONTRIBUTION'
  /** `contributionAmount > 1_000_000`. */
  | 'INVESTMENT_CONTRIBUTION_TOO_LARGE'
  /** `years` is not a whole number. */
  | 'INVESTMENT_YEARS_NOT_INTEGER'
  /** `years` outside [1, 100]. */
  | 'INVESTMENT_HORIZON_INVALID'
  /** `compoundingFrequency`, `contributionFrequency`, or `contributionTiming` is not a recognized value. */
  | 'INVESTMENT_INVALID_ENUM_VALUE';

/**
 * Thrown when caller-supplied input to `runInvestmentProjection` violates an invariant.
 *
 * Same `.code`/`.message` shape as `InvalidProjectionInputError` (`errors.ts`), but its
 * own class — this module does not extend that one (ERD §2).
 */
export class InvalidInvestmentInputError extends Error {
  readonly code: InvestmentCalculatorErrorCode;

  constructor(code: InvestmentCalculatorErrorCode, message: string) {
    super(message);
    this.name = 'InvalidInvestmentInputError';
    this.code = code;
  }
}

const COMPOUNDING_PERIODS_PER_YEAR: Record<CompoundingFrequency, number> = {
  annually: 1,
  semiAnnually: 2,
  quarterly: 4,
  monthly: 12,
  daily: 365,
};

const CONTRIBUTION_PERIODS_PER_YEAR: Record<ContributionFrequency, number> = {
  annually: 1,
  monthly: 12,
};

const COMPOUNDING_FREQUENCIES = new Set<CompoundingFrequency>([
  'annually',
  'semiAnnually',
  'quarterly',
  'monthly',
  'daily',
]);
const CONTRIBUTION_FREQUENCIES = new Set<ContributionFrequency>(['monthly', 'annually']);
const CONTRIBUTION_TIMINGS = new Set<ContributionTiming>(['start', 'end']);

const fail = (code: InvestmentCalculatorErrorCode, message: string): never => {
  throw new InvalidInvestmentInputError(code, message);
};

const assertFinite = (value: number, label: string): void => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail('INVESTMENT_NON_FINITE_INPUT', `${label} must be a finite number, got ${value}.`);
  }
};

/** Validates raw input and returns it with defaults applied. Throws `InvalidInvestmentInputError` on any violation. */
const validate = (
  input: InvestmentProjectionInput,
): Required<InvestmentProjectionInput> => {
  const compoundingFrequency = input.compoundingFrequency ?? 'annually';
  const contributionTiming = input.contributionTiming ?? 'end';

  assertFinite(input.startingAmount, 'startingAmount');
  assertFinite(input.annualGrowthRate, 'annualGrowthRate');
  assertFinite(input.contributionAmount, 'contributionAmount');
  assertFinite(input.years, 'years');

  if (!COMPOUNDING_FREQUENCIES.has(compoundingFrequency)) {
    fail('INVESTMENT_INVALID_ENUM_VALUE', `Unrecognized compoundingFrequency: ${compoundingFrequency}.`);
  }
  if (!CONTRIBUTION_FREQUENCIES.has(input.contributionFrequency)) {
    fail('INVESTMENT_INVALID_ENUM_VALUE', `Unrecognized contributionFrequency: ${input.contributionFrequency}.`);
  }
  if (!CONTRIBUTION_TIMINGS.has(contributionTiming)) {
    fail('INVESTMENT_INVALID_ENUM_VALUE', `Unrecognized contributionTiming: ${contributionTiming}.`);
  }

  if (input.startingAmount < 0) {
    fail('INVESTMENT_NEGATIVE_STARTING_AMOUNT', `startingAmount must be >= 0, got ${input.startingAmount}.`);
  }
  if (input.startingAmount > 100_000_000) {
    fail(
      'INVESTMENT_STARTING_AMOUNT_TOO_LARGE',
      `startingAmount must be <= 100,000,000, got ${input.startingAmount}.`,
    );
  }

  if (input.annualGrowthRate < -10 || input.annualGrowthRate > 30) {
    fail(
      'INVESTMENT_GROWTH_RATE_OUT_OF_RANGE',
      `annualGrowthRate must be between -10 and 30 (percent), got ${input.annualGrowthRate}.`,
    );
  }

  if (input.contributionAmount < 0) {
    fail(
      'INVESTMENT_NEGATIVE_CONTRIBUTION',
      `contributionAmount must be >= 0, got ${input.contributionAmount}.`,
    );
  }
  if (input.contributionAmount > 1_000_000) {
    fail(
      'INVESTMENT_CONTRIBUTION_TOO_LARGE',
      `contributionAmount must be <= 1,000,000, got ${input.contributionAmount}.`,
    );
  }

  if (!Number.isInteger(input.years)) {
    fail('INVESTMENT_YEARS_NOT_INTEGER', `years must be a whole number, got ${input.years}.`);
  }
  if (input.years < 1 || input.years > 100) {
    fail('INVESTMENT_HORIZON_INVALID', `years must be between 1 and 100, got ${input.years}.`);
  }

  return {
    startingAmount: input.startingAmount,
    annualGrowthRate: input.annualGrowthRate,
    compoundingFrequency,
    contributionAmount: input.contributionAmount,
    contributionFrequency: input.contributionFrequency,
    contributionTiming,
    years: input.years,
  };
};

/**
 * Runs a period-by-period investment projection.
 *
 * Algorithm (ERD §2, DECIDED simple-sum convention): iterates at
 * `compoundingFrequency` granularity. Within each compounding period, every
 * contribution event due during that period (per `contributionFrequency`) is
 * summed arithmetically into a pending bucket with no interim growth; the whole
 * bucket is then credited to the running balance at the start or end of that
 * compounding period per `contributionTiming`, and growth at
 * `annualGrowthRate / periodsPerYear` is applied once per period. This single
 * formula covers every `compoundingFrequency` x `contributionFrequency`
 * combination, including when contributions are more frequent than compounding
 * (bucketed together) or less frequent (a single event lands in one period's
 * bucket).
 *
 * `rows` is captured at year-end boundaries regardless of the internal
 * sub-annual granularity: one row per year of the horizon, plus one for year 0.
 *
 * All iteration is done in full floating-point precision; rounding is the
 * caller's responsibility at display time.
 */
export const runInvestmentProjection = (
  input: InvestmentProjectionInput,
): InvestmentProjectionResult => {
  const { startingAmount, annualGrowthRate, compoundingFrequency, contributionAmount, contributionFrequency, contributionTiming, years } =
    validate(input);

  const periodsPerYear = COMPOUNDING_PERIODS_PER_YEAR[compoundingFrequency];
  const contributionPeriodsPerYear = CONTRIBUTION_PERIODS_PER_YEAR[contributionFrequency];
  const periodRate = annualGrowthRate / 100 / periodsPerYear;

  // Precompute, for each within-year compounding period index, how many
  // contribution events (of `contributionPeriodsPerYear` total per year) land in
  // that period's bucket. Contribution due dates are anchored to match
  // `contributionTiming`: for `'start'`, event c (0-indexed) is due at fraction
  // c / contributionPeriodsPerYear of the year, landing in compounding period
  // floor(fraction * periodsPerYear); for `'end'`, event c is due at fraction
  // (c + 1) / contributionPeriodsPerYear, landing in period
  // ceil(fraction * periodsPerYear) - 1. The two formulas agree whenever
  // `contributionPeriodsPerYear === periodsPerYear`, and only diverge when
  // compounding is coarser than contributions — e.g. an annual contribution under
  // semiannual compounding lands in the first half-year for `'start'` but the
  // second half-year for `'end'`, matching the calculator.net oracle (ERD §4).
  const contributionsPerPeriod: number[] = new Array(periodsPerYear).fill(0);
  for (let c = 0; c < contributionPeriodsPerYear; c += 1) {
    const periodIndex =
      contributionTiming === 'start'
        ? Math.min(periodsPerYear - 1, Math.floor((c * periodsPerYear) / contributionPeriodsPerYear))
        : Math.max(
            0,
            Math.ceil(((c + 1) * periodsPerYear) / contributionPeriodsPerYear) - 1,
          );
    contributionsPerPeriod[periodIndex] += 1;
  }

  let balance = startingAmount;
  let totalContributions = 0;
  const rows: YearRow[] = [{ year: 0, balance }];

  for (let year = 0; year < years; year += 1) {
    for (let i = 0; i < periodsPerYear; i += 1) {
      const periodContribution = contributionsPerPeriod[i] * contributionAmount;

      if (contributionTiming === 'start' && periodContribution > 0) {
        balance += periodContribution;
        totalContributions += periodContribution;
      }

      balance *= 1 + periodRate;

      if (contributionTiming === 'end' && periodContribution > 0) {
        balance += periodContribution;
        totalContributions += periodContribution;
      }
    }

    rows.push({ year: year + 1, balance });
  }

  const finalBalance = balance;
  const totalGrowth = finalBalance - startingAmount - totalContributions;

  return { finalBalance, totalContributions, totalGrowth, rows };
};
