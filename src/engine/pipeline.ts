/**
 * The per-period pipeline: a fixed, named stage sequence run once per projected year.
 *
 * The stage order is the architectural commitment (Engine Architecture Design, Pipeline /
 * step function). Later stories extend the engine by filling in stages, swapping strategy
 * implementations, or adding `PlanEvent` types — not by reordering this list.
 *
 * Scaffolding note: every stage below is an identity stub. The real pre-retirement and
 * retirement math lands in the next ticket (ERD §5, WP-1b), which fills in these bodies
 * without changing their signatures. Downstream work packages can build against these
 * signatures now.
 */

import type { PeriodState, PipelineStage, RunPeriodInput } from './types';

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
export const computeIncome: PipelineStage = (state, _input) => state;

/**
 * Determines this period's intended withdrawal and asks the withdrawal strategy to source it.
 *
 * Retirement only: the first retirement year withdraws
 * `balanceAtStartOfFirstRetirementYear * withdrawalRateInRetirement`, and every year after
 * inflates the prior withdrawal by `inflationRate`.
 */
export const computeWithdrawals: PipelineStage = (state, _input) => state;

/** Applies tax owed on this period's income and withdrawals. Zero for Stories 1-3. */
export const applyTax: PipelineStage = (state, _input) => state;

/** Appends this period's `ProjectionRow` to the accumulated output. */
export const recordPeriod: PipelineStage = (state, _input) => state;

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
