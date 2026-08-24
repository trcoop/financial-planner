import { describe, expect, it } from 'vitest';

import * as engine from './index';
import type {
  MonteCarloOptions,
  MonteCarloResult,
  PathBalances,
  PercentilePaths,
  PeriodState,
  PipelineStage,
  PlanAssumptions,
  PlanEvent,
  PortfolioAllocation,
  PortfolioValue,
  ProjectionErrorCode,
  ProjectionRow,
  HistoricalYearInflation,
  HistoricalYearReturn,
  RandomSource,
  ReturnModel,
  RunPeriodInput,
  TaxCalculator,
  TaxContext,
  TaxResult,
  TrialConfig,
  VolatilityAssumptions,
  WithdrawalPlan,
  WithdrawalStrategy,
} from './index';

/**
 * Types erase at runtime, so the `Object.keys` assertions below are blind to them — yet
 * the type half of the barrel is what most downstream tickets consume (`ProjectionRow`
 * for Story 3's UI, `RunPeriodInput` for FIN-17/18). `tsc -b` typechecks this file as
 * part of `npm run build`, so importing every type export by name from the barrel makes
 * the build fail with TS2305 if any of them is dropped from `index.ts`.
 */
type PublicTypeSurface = {
  periodState: PeriodState;
  pipelineStage: PipelineStage;
  planAssumptions: PlanAssumptions;
  planEvent: PlanEvent;
  portfolioValue: PortfolioValue;
  projectionErrorCode: ProjectionErrorCode;
  projectionRow: ProjectionRow;
  runPeriodInput: RunPeriodInput;
  taxCalculator: TaxCalculator;
  taxContext: TaxContext;
  taxResult: TaxResult;
  withdrawalPlan: WithdrawalPlan;
  withdrawalStrategy: WithdrawalStrategy;
  monteCarloOptions: MonteCarloOptions;
  monteCarloResult: MonteCarloResult;
  pathBalances: PathBalances;
  percentilePaths: PercentilePaths;
  portfolioAllocation: PortfolioAllocation;
  randomSource: RandomSource;
  trialConfig: TrialConfig;
  volatilityAssumptions: VolatilityAssumptions;
  historicalYearInflation: HistoricalYearInflation;
  historicalYearReturn: HistoricalYearReturn;
  returnModel: ReturnModel;
};

/**
 * The barrel is the documented public surface: downstream tickets import from
 * `src/engine`, not from the individual modules. Nothing else in this package imports
 * through it, so without these assertions a dropped re-export stays green here and
 * surfaces as a build break in a consumer's branch instead.
 */
describe('public surface', () => {
  const runtimeExports = [
    'InvalidProjectionInputError',
    'withdrawFullShortfall',
    'zeroTax',
    'applyGrowth',
    'applyLifeEvents',
    'computeIncome',
    'computeWithdrawals',
    'applyTax',
    'recordPeriod',
    'pipelineStages',
    'runStages',
    'runPeriod',
    'runProjection',
    'validatePlanAssumptions',
    'createInitialPeriodState',
    'createSeededRandom',
    'createRandomSeed',
    'validateAllocation',
    'runMonteCarloTrial',
    'runMonteCarloTrials',
    'DEFAULT_SIMULATION_COUNT',
    'DEFAULT_VOLATILITY_ASSUMPTIONS',
    'correlatedNormals',
    'DEFAULT_CORRELATION',
    'DEFAULT_RETURN_ASSUMPTIONS',
    'expectedPortfolioReturn',
    'createHistoricalReturnGenerator',
    'DEFAULT_BLOCK_LENGTH_YEARS',
    'HISTORICAL_ANNUAL_RETURNS',
    // FIN-65: paired with HISTORICAL_ANNUAL_RETURNS — the Monte Carlo historical path draws
    // a period's return and its cost-of-living increase from the same year.
    'HISTORICAL_ANNUAL_INFLATION',
  ];

  it.each(runtimeExports)('re-exports %s', (name) => {
    expect(engine).toHaveProperty(name);
  });

  it('exports nothing beyond the documented surface', () => {
    expect(Object.keys(engine).sort()).toEqual([...runtimeExports].sort());
  });

  it('re-exports every documented type (enforced by tsc at build time, not here)', () => {
    // The assertion that matters is the `PublicTypeSurface` declaration above: if a type
    // is missing from the barrel, `npm run build` fails before this test ever runs. This
    // body exists only so the type is referenced rather than pruned as unused.
    const surface: Partial<PublicTypeSurface> = {};

    expect(surface).toEqual({});
  });
});
