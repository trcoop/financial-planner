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
