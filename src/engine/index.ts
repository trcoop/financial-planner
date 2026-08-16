/**
 * Public surface of the projection engine.
 *
 * Consumers (UI, worker orchestration, tests) import from here rather than reaching into
 * individual modules, so the internal file layout can change without breaking callers.
 *
 * Pure TypeScript throughout: no React, no I/O, no external dependencies.
 */

export { InvalidProjectionInputError } from './errors';
export type { ProjectionErrorCode } from './errors';

export { withdrawFullShortfall, zeroTax } from './strategies';

export {
  applyGrowth,
  applyLifeEvents,
  applyTax,
  computeIncome,
  computeWithdrawals,
  pipelineStages,
  recordPeriod,
  runPeriod,
  runStages,
} from './pipeline';

/**
 * `validatePlanAssumptions` and `createInitialPeriodState` are exported alongside the
 * entry point because Story 2's Monte Carlo validates the same `PlanAssumptions` at its own
 * boundary and folds from the same year-0 state — sharing them keeps the two entry points
 * from drifting on error codes or initial conditions.
 */
export { createInitialPeriodState, runProjection, validatePlanAssumptions } from './projection';

export type {
  PeriodState,
  PipelineStage,
  PlanAssumptions,
  PlanEvent,
  PortfolioValue,
  ProjectionRow,
  RunPeriodInput,
  TaxCalculator,
  TaxContext,
  TaxResult,
  WithdrawalPlan,
  WithdrawalStrategy,
} from './types';

export {
  createRandomSeed,
  createSeededRandom,
  runMonteCarloTrial,
  runMonteCarloTrials,
  validateAllocation,
  DEFAULT_SIMULATION_COUNT,
  DEFAULT_VOLATILITY_ASSUMPTIONS,
} from './monteCarlo';

export type {
  MonteCarloOptions,
  MonteCarloResult,
  PathBalances,
  PercentilePaths,
  PortfolioAllocation,
  RandomSource,
  TrialConfig,
  VolatilityAssumptions,
} from './monteCarlo';
