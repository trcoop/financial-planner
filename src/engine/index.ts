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
  snapshotBeginningBalance,
} from './pipeline';

/**
 * `validatePlanAssumptions` and `createInitialPeriodState` are exported alongside the
 * entry point because Story 2's Monte Carlo validates the same `PlanAssumptions` at its own
 * boundary and folds from the same year-0 state — sharing them keeps the two entry points
 * from drifting on error codes or initial conditions.
 */
export {
  createInitialPeriodState,
  realReturn,
  runProjection,
  toTodaysDollarRows,
  validatePlanAssumptions,
  validatePlanEvents,
} from './projection';

export type {
  AdditionalIncome,
  EventCostEntry,
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
  correlatedNormals,
  createHistoricalReturnGenerator,
  createRandomSeed,
  createSeededRandom,
  blendedPortfolioReturn,
  runMonteCarloTrial,
  runMonteCarloTrials,
  validateAllocation,
  DEFAULT_BLOCK_LENGTH_YEARS,
  DEFAULT_CORRELATION,
  DEFAULT_RETURN_ASSUMPTIONS,
  DEFAULT_SIMULATION_COUNT,
  DEFAULT_VOLATILITY_ASSUMPTIONS,
} from './monteCarlo';

export type {
  MonteCarloOptions,
  MonteCarloResult,
  PathBalances,
  PercentilePaths,
  PercentileViews,
  PortfolioAllocation,
  RandomSource,
  ReturnAssumptions,
  ReturnModel,
  TrialConfig,
  TrialPath,
  VolatilityAssumptions,
} from './monteCarlo';

export { HISTORICAL_ANNUAL_RETURNS } from './historicalReturns';
export type { HistoricalYearReturn } from './historicalReturns';

export { HISTORICAL_ANNUAL_INFLATION } from './inflationData';
export type { HistoricalYearInflation } from './inflationData';

/**
 * Federal Tax Engine (FIN-150, WP-F). `computeFederalTax` is NOT wired into `runProjection` or
 * `pipeline.ts` — `applyTax` stays on `zeroTax` — that wiring is a follow-on project's job (see
 * this project's ERD §1.1). These exports let a caller (or a Ladle story) compute a standalone
 * federal tax result today.
 *
 * `STORY_INDEXING`/`STORY_FIXTURES`/`StoryScenarioName` are deliberately NOT re-exported here —
 * they are story/test scaffolding for the tax module's own chart components, imported via
 * `src/engine/tax/storyFixtures.ts` directly, and promoting them here would put scaffolding on
 * the engine's documented public surface.
 */
export { computeFederalTax, resolveTables, TAX_TABLES } from './tax';
export type {
  BracketOccupancy,
  Confidence,
  DeductionBreakdown,
  FederalTaxInput,
  FederalTaxResult,
  FicaBreakdown,
  FicaParameters,
  FilingStatus,
  IndexedAmount,
  IndexedLadder,
  IndexingPolicy,
  IndexingRates,
  Ladder,
  LadderBand,
  ResolvedYearTables,
  RoundingRule,
  SeniorBonusParameters,
  TaxPayer,
} from './tax';
