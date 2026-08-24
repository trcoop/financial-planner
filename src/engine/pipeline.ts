/**
 * The per-period pipeline: a fixed, named stage sequence run once per projected year.
 *
 * The stage order is the architectural commitment (Engine Architecture Design, Pipeline /
 * step function). Later stories extend the engine by filling in stages, swapping strategy
 * implementations, or adding `PlanEvent` types — not by reordering this list.
 *
 * Every stage carries its Story 1 accumulation and drawdown behaviour (ERD §5, WP-1b), with
 * the sole exception of {@link applyLifeEvents}, which stays an intentional no-op until
 * Story 3 gives `PlanEvent` a meaning. The horizon is deliberately not represented here:
 * folding these stages across a range of years is `runProjection`'s job, which is what lets
 * Monte Carlo reuse the same step function with a per-period return.
 */

import type { PeriodState, PipelineStage, PlanAssumptions, RunPeriodInput } from './types';

/**
 * Whether a period falls in the drawdown phase.
 *
 * `>=`, so the retirement year itself is a drawdown year. Already-retired users
 * (`retirementAge <= currentAge`) are therefore in drawdown from year 0 — a valid, supported
 * scenario rather than an input error (Story 1 PRD, Edge Cases).
 */
const isRetired = (age: number, assumptions: PlanAssumptions): boolean => age >= assumptions.retirementAge;

/**
 * Grows the balance by this period's return.
 *
 * Owns two side-obligations the later stages depend on: it snapshots `beginningBalance`
 * from the incoming `balance` and stores the computed `investmentReturn` dollar amount,
 * both of which {@link recordPeriod} reads back. Neither is recoverable once `balance` is
 * overwritten with the post-growth value, which is why they are carried explicitly.
 */
export const applyGrowth: PipelineStage = (state, input) => {
  const beginningBalance = state.balance;

  return {
    ...state,
    beginningBalance,
    // Stated against the period's own return, not `assumptions.annualReturnRate`: the
    // deterministic projection is just the case where the two are equal every year, while a
    // Monte Carlo trial varies `returnForPeriod` per period through this same stage.
    investmentReturn: beginningBalance * input.returnForPeriod,
    // `x * (1 + r)` rather than `x + investmentReturn` to match ERD §5's ending-balance
    // formula literally — the two differ in the last bit or two under IEEE-754.
    balance: beginningBalance * (1 + input.returnForPeriod),
  };
};

/** Applies any life events active this period. Always a no-op for Stories 1-3 — no UI populates events yet. */
export const applyLifeEvents: PipelineStage = (state, _input) => state;

/**
 * Computes this period's income and contribution.
 *
 * Pre-retirement only: year 0 uses `currentAnnualIncome` as-is, later years apply
 * `annualRaiseRate` to the prior year's income. Contributions are 0 in retirement.
 */
export const computeIncome: PipelineStage = (state, input) => {
  const { assumptions } = input;

  // Retirement has no earned income in Story 1's model, so the raise chain is a
  // pre-retirement concern only. Income is zeroed rather than frozen at its last working
  // value so that `priorIncome` always reads as "income earned this period".
  if (isRetired(state.age, assumptions)) {
    return { ...state, priorIncome: 0, annualContribution: 0 };
  }

  // Raises start in year 1: year 0 is the user's income as entered today.
  const income =
    state.year === 0 ? assumptions.currentAnnualIncome : state.priorIncome * (1 + assumptions.annualRaiseRate);
  const annualContribution = income * assumptions.annualContributionRate;

  return {
    ...state,
    priorIncome: income,
    annualContribution,
    // Contributions land at year end and so earn no return in the year they are made
    // (Story 1 PRD, Edge Cases) — hence added after `applyGrowth`, not before it.
    balance: state.balance + annualContribution,
  };
};

/**
 * Determines this period's intended withdrawal and asks the withdrawal strategy to source it.
 *
 * Retirement only: the first retirement year withdraws
 * `balanceAtStartOfFirstRetirementYear * withdrawalRateInRetirement`, and every year after
 * inflates the prior withdrawal by this period's inflation rate.
 */
export const computeWithdrawals: PipelineStage = (state, input) => {
  const { assumptions, withdrawalStrategy } = input;

  if (!isRetired(state.age, assumptions)) {
    return { ...state, annualWithdrawal: 0 };
  }

  /**
   * The period's own inflation when the caller knows it, the plan's flat assumption otherwise
   * (FIN-65).
   *
   * The `??` fallback is load-bearing, not defensive coding — it is the whole scope fence
   * between the two kinds of caller:
   *
   * - Monte Carlo's *historical* path sets `inflationForPeriod` to the realised CPI-U of the
   *   very historical year it drew this period's return from. Pairing them is what the
   *   safe-withdrawal-rate literature does (Bengen 1994, Trinity); leaving them unpaired ran
   *   nominal 1970s returns against a placid invented 2.5% cost of living, which does not
   *   merely bias the mean — it inverts the cohort ranking.
   * - The deterministic projection (`runProjection`, the Plan tab) and Monte Carlo's GBM
   *   branch have no historical year to key off, so they never set it and stay on
   *   `assumptions.inflationRate`. The Plan tab pairing a user-chosen nominal return with a
   *   user-chosen nominal inflator is internally consistent, and FIN-65 must not leak into it.
   *
   * `??` and not `||`: 1929's CPI-U is exactly 0.0000, which `||` would silently replace with
   * the plan's rate.
   */
  const inflationRate = input.inflationForPeriod ?? assumptions.inflationRate;

  // `priorWithdrawal === null` is what marks the first retirement year, so this works
  // identically whether retirement is reached mid-projection or was already underway at
  // year 0. The first year rates `beginningBalance` — the balance at the *start* of the
  // year, before `applyGrowth` — per ERD §5.
  const requested =
    state.priorWithdrawal === null
      ? state.beginningBalance * assumptions.withdrawalRateInRetirement
      : state.priorWithdrawal * (1 + inflationRate);

  const plan = withdrawalStrategy(state, requested);

  return {
    ...state,
    // The *requested* figure compounds, never the sourced one: this models a spending need
    // that rises with inflation whether or not the portfolio could fund last year's draw.
    // See `PeriodState.priorWithdrawal` (resolved 2026-08-15, FIN-15 review).
    priorWithdrawal: requested,
    // The row reports, and the balance is reduced by, what actually left the portfolio.
    annualWithdrawal: plan.amount,
    balance: state.balance - plan.amount,
  };
};

/** Applies tax owed on this period's income and withdrawals. Zero for Stories 1-3. */
export const applyTax: PipelineStage = (state, input) => {
  const { taxOwed } = input.taxCalculator(state.priorIncome, state.annualWithdrawal, {
    age: state.age,
    year: state.year,
  });

  // Always zero for Stories 1-3, so this subtraction is a no-op today. It is wired anyway so
  // that swapping in real bracket math is an implementation change behind the existing
  // interface, not a pipeline change.
  return { ...state, balance: state.balance - taxOwed };
};

/** Appends this period's `ProjectionRow` to the accumulated output. */
export const recordPeriod: PipelineStage = (state, _input) => ({
  ...state,
  // A projection of the state the earlier stages built, with no arithmetic of its own —
  // every figure here was computed by the stage that owns it. A new array rather than a
  // push, so the state handed in is never mutated.
  rows: [
    ...state.rows,
    {
      age: state.age,
      year: state.year,
      beginningBalance: state.beginningBalance,
      annualContribution: state.annualContribution,
      investmentReturn: state.investmentReturn,
      annualWithdrawal: state.annualWithdrawal,
      endingBalance: state.balance,
    },
  ],
});

/**
 * The pipeline's fixed stage order.
 *
 * `applyGrowth -> applyLifeEvents -> computeIncome -> computeWithdrawals -> applyTax -> recordPeriod`
 */
export const pipelineStages: readonly PipelineStage[] = [
  applyGrowth,
  applyLifeEvents,
  computeIncome,
  computeWithdrawals,
  applyTax,
  recordPeriod,
];

/** Folds an ordered list of stages over a state, feeding each stage the previous one's output. */
export const runStages = (
  stages: readonly PipelineStage[],
  state: PeriodState,
  input: RunPeriodInput,
): PeriodState => stages.reduce((current, stage) => stage(current, input), state);

/**
 * Runs one period of the plan: the engine's core step function.
 *
 * Deliberately synchronous and free of any knowledge of workers or cancellation — Tier 2's
 * cancel-on-input-change behaviour lives in the worker orchestration layer, not here. Monte
 * Carlo reuses this same step function, varying only `input.returnForPeriod` per period,
 * rather than reimplementing the projection.
 */
export const runPeriod = (state: PeriodState, input: RunPeriodInput): PeriodState =>
  runStages(pipelineStages, state, input);
