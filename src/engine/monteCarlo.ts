/**
 * Monte Carlo simulation core (Story 2, ERD §5).
 *
 * Pure and synchronous throughout: no worker, no Promise, no I/O. The Web Worker that runs
 * this off the main thread and owns cancellation is a separate layer outside `src/engine/`
 * (ERD §3, round-1 review) — it wraps {@link runMonteCarloTrials} rather than replacing it.
 */

import { InvalidProjectionInputError } from './errors';
import { runPeriod } from './pipeline';
import { withdrawFullShortfall, zeroTax } from './strategies';
import type {
  PeriodState,
  PipelineStage,
  PlanAssumptions,
  PlanEvent,
  TaxCalculator,
  WithdrawalStrategy,
} from './types';

/** A uniform random source over `[0, 1)`, the shape both `Math.random` and the seeded PRNG share. */
export type RandomSource = () => number;

/**
 * A `mulberry32` PRNG: ~10 lines, no dependency, and — unlike `Math.random` — seedable,
 * which R1's "deterministic given the same seed" acceptance criterion requires.
 */
export const createSeededRandom = (seed: number): RandomSource => {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let drawn = state;
    drawn = Math.imul(drawn ^ (drawn >>> 15), drawn | 1);
    drawn ^= drawn + Math.imul(drawn ^ (drawn >>> 7), drawn | 61);
    return ((drawn ^ (drawn >>> 14)) >>> 0) / 4_294_967_296;
  };
};

/**
 * A fresh 32-bit seed for a run that was not given one.
 *
 * Everyday use should vary run to run (ERD §5, "fresh-per-run, not cached"); only tests pin
 * a seed. `crypto.getRandomValues` is available on both the main thread and inside a Worker,
 * and — unlike `Math.random` — is not what is being replaced here, so using it to seed
 * carries no reproducibility cost.
 */
export const createRandomSeed = (): number => crypto.getRandomValues(new Uint32Array(1))[0];

/**
 * One standard normal deviate via the Box-Muller transform, consuming two uniform draws.
 *
 * `1 - draw()` maps the source's `[0, 1)` onto `(0, 1]`, which keeps `Math.log` away from
 * the `-Infinity` it would return for an exactly-zero draw.
 */
export const standardNormal = (draw: RandomSource): number => {
  const magnitude = 1 - draw();
  const angle = draw();

  return Math.sqrt(-2 * Math.log(magnitude)) * Math.cos(2 * Math.PI * angle);
};

/** One period is one year: the projection advances a year at a time, so `dt` is 1. */
const PERIOD_YEARS = 1;

/**
 * One asset's return for one period under geometric Brownian motion (ERD §5):
 *
 * `R[t] = exp((mu - sigma^2 / 2) * dt + sigma * sqrt(dt) * Z[t]) - 1`
 *
 * Each period is an independent draw applied to that period's *balance*. It is deliberately
 * not compounded onto the previous period's return value — the Story 2 PRD's literal
 * `Return[t+1] = Return[t] * exp(...)` wording is a transcription error, resolved in
 * ERD §11 item 1: it is the balance that compounds, not the return.
 *
 * `meanReturn` is the single blended mean return for the whole portfolio
 * (`PlanAssumptions.annualReturnRate`) — Story 2 does not split mean return by asset class,
 * only volatility.
 *
 * **OPEN DECISION (FIN-17 review, 2026-08-16) — is `annualReturnRate` the log-drift or the
 * expected return?** This implementation follows ERD §5's formula literally: the user's rate
 * goes into the exponent as `mu`. But under GBM `E[R] = exp(mu) - 1`, so a plan that says
 * "7% return" actually has an expected return of 7.2508%, and ERD §5 simultaneously calls
 * `mu` "the single blended mean return" — which it is not. Two consequences:
 *
 * 1. Story 1's deterministic projection applies `annualReturnRate` as a plain arithmetic
 *    rate (ERD §5, `investmentReturn = beginningBalance x annualReturnRate`), so the Monte
 *    Carlo *mean* sits ~7.3% above the Tier 1 line at 30 years and ~16.7% at 66 years,
 *    purely from this interpretation. Story 3 plots both on one chart. (Those are growth
 *    factor ratios, `(exp(0.07) / 1.07)^n - 1`, i.e. the lump-sum case; a plan with
 *    contributions and withdrawals diverges by a different amount — 4.3% over the 25-year
 *    accumulation scenario, 21.9% over a 66-year full lifecycle.)
 * 2. An external calculator asked for "7%" produces the 7% projection, which is ~6.0% away
 *    from this engine's mean over a 25-year horizon — outside the ticket's own 2% band.
 *
 * The one-line alternative is `mu = Math.log(1 + annualReturnRate)`, which makes `E[R]`
 * exactly the user's 7% and reconciles both tiers. That is a product decision about what the
 * "Investment return" input means, not an implementation detail, so it is deliberately left
 * as the ERD specifies rather than changed unilaterally here. Needs Travis's call before
 * FIN-19 draws Tier 1 and Tier 2 together. The test
 * `treats annualReturnRate as GBM log-drift, so the expected return is exp(rate) - 1` pins
 * the current convention, so switching is a deliberate edit rather than a silent drift.
 */
export const gbmPeriodReturn = (meanReturn: number, volatility: number, deviate: number): number =>
  Math.exp(
    (meanReturn - (volatility * volatility) / 2) * PERIOD_YEARS +
      volatility * Math.sqrt(PERIOD_YEARS) * deviate,
  ) - 1;

/** A portfolio split between stocks and bonds, on a 0-100 percent scale summing to 100. */
export interface PortfolioAllocation {
  stocksPercent: number;
  bondsPercent: number;
}

/**
 * Blends the two asset returns by allocation weight:
 * `R_portfolio = (stocksPercent / 100) * R_stocks + (bondsPercent / 100) * R_bonds`.
 */
export const blendedPortfolioReturn = (
  allocation: PortfolioAllocation,
  stockReturn: number,
  bondReturn: number,
): number =>
  (allocation.stocksPercent / 100) * stockReturn + (allocation.bondsPercent / 100) * bondReturn;

/** One simulated path's ending balance for each projected year, index 0 being the current age. */
export type PathBalances = readonly number[];

/** The percentile fan the UI plots, one value per year (ERD §4). */
export interface PercentilePaths {
  p10: number[];
  p50: number[];
  p90: number[];
}

/**
 * Nearest-rank index into an ascending sample: the 10th percentile of 1,000 observations is
 * the 100th smallest, at index 99 (ERD §5, matching R3's "100th-worst" wording).
 */
const nearestRankIndex = (sampleCount: number, percentile: number): number =>
  Math.min(sampleCount - 1, Math.max(0, Math.ceil((percentile / 100) * sampleCount) - 1));

/**
 * Extracts the 10th/50th/90th percentile fan **cross-sectionally**: every year is sorted
 * independently across all paths.
 *
 * This is standard fan-chart methodology and the only construction that satisfies the
 * required `p10 <= p50 <= p90` ordering at every year — a fixed-path-identity line cannot,
 * because paths cross rank over time (ERD §11 item 2). A percentile line here is therefore
 * not one simulated path's story; it is the shape of the distribution year by year.
 */
export const extractPercentiles = (balancesByPath: readonly PathBalances[]): PercentilePaths => {
  const yearCount = balancesByPath.length === 0 ? 0 : balancesByPath[0].length;
  const pathCount = balancesByPath.length;
  const percentiles: PercentilePaths = { p10: [], p50: [], p90: [] };

  for (let year = 0; year < yearCount; year += 1) {
    const balancesThisYear = balancesByPath.map((path) => path[year]).sort((a, b) => a - b);

    percentiles.p10.push(balancesThisYear[nearestRankIndex(pathCount, 10)]);
    percentiles.p50.push(balancesThisYear[nearestRankIndex(pathCount, 50)]);
    percentiles.p90.push(balancesThisYear[nearestRankIndex(pathCount, 90)]);
  }

  return percentiles;
};

/**
 * Share of paths that never went negative, as a whole percentage 0-100 (ERD §5).
 *
 * "Never negative" is checked against every year's ending balance: a plan that recovers by
 * the horizon after running dry mid-retirement is still a failed plan.
 */
export const computeSuccessRate = (balancesByPath: readonly PathBalances[]): number => {
  // No paths means nothing succeeded. `runMonteCarloTrials` rejects an empty batch before
  // reaching here, but the naked division would otherwise hand the UI a NaN success rate.
  if (balancesByPath.length === 0) {
    return 0;
  }

  const successes = balancesByPath.filter((path) =>
    path.every((balance) => balance >= 0),
  ).length;

  return Math.round((100 * successes) / balancesByPath.length);
};

/**
 * How far an allocation's weights may sum from 100 and still be accepted.
 *
 * An exact `!== 100` check is a floating-point landmine: a valid 33.33/66.67 split sums to
 * 100.00000000000001 (ERD §6, round-1 review).
 */
const ALLOCATION_SUM_EPSILON = 1e-9;

/** Throws `NON_FINITE_INPUT` for anything that is not a real number. */
const assertFinite = (value: number, field: string): void => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new InvalidProjectionInputError(
      'NON_FINITE_INPUT',
      `${field} must be a finite number, received ${String(value)}`,
    );
  }
};

/**
 * Validates a caller-supplied allocation at the input boundary, before any path is folded
 * (ERD §6). Order matters: finiteness is checked first, because `Math.abs(NaN - 100) > eps`
 * is `false` and a sum check running first would wave `NaN` straight through into the fold.
 */
export const validateAllocation = (allocation: PortfolioAllocation): void => {
  assertFinite(allocation?.stocksPercent, 'allocation.stocksPercent');
  assertFinite(allocation?.bondsPercent, 'allocation.bondsPercent');

  const sum = allocation.stocksPercent + allocation.bondsPercent;
  if (Math.abs(sum - 100) > ALLOCATION_SUM_EPSILON) {
    throw new InvalidProjectionInputError(
      'ALLOCATION_SUM_INVALID',
      `allocation must sum to 100%, received ${allocation.stocksPercent}% stocks + ${allocation.bondsPercent}% bonds = ${sum}%`,
    );
  }

  if (allocation.stocksPercent <= 0 || allocation.bondsPercent <= 0) {
    throw new InvalidProjectionInputError(
      'ALLOCATION_ZERO_WEIGHT',
      `allocation must put positive weight on both stocks and bonds, received ${allocation.stocksPercent}% stocks and ${allocation.bondsPercent}% bonds`,
    );
  }
};

/** Annual volatility per asset class, as decimals (ERD §5, R5). */
export interface VolatilityAssumptions {
  stocks: number;
  bonds: number;
}

/**
 * One period's portfolio return: an independent GBM draw per asset class, blended by
 * allocation weight. Consumes four uniform draws — two per Box-Muller deviate.
 *
 * Stocks and bonds are drawn independently; modelling their historical correlation is
 * explicitly P1 (Story 2 PRD, R10), not P0.
 */
export const drawPortfolioReturn = (
  meanReturn: number,
  allocation: PortfolioAllocation,
  volatility: VolatilityAssumptions,
  draw: RandomSource,
): number =>
  blendedPortfolioReturn(
    allocation,
    gbmPeriodReturn(meanReturn, volatility.stocks, standardNormal(draw)),
    gbmPeriodReturn(meanReturn, volatility.bonds, standardNormal(draw)),
  );

/**
 * The state a fold starts from, at `currentAge` in year 0 holding `initialBalance`.
 *
 * `priorIncome` starts at 0 and `beginningBalance`/`investmentReturn` start unset because no
 * period has run yet: year 0 takes its income from `currentAnnualIncome` directly and
 * `applyGrowth` populates the other two before `recordPeriod` reads them (ERD §4, §5).
 *
 * Story 1's `runProjection` needs the identical starting state. It is exported here so the
 * two folds can converge on one definition at FIN-19 integration rather than drifting.
 */
export const createInitialPeriodState = (plan: PlanAssumptions): PeriodState => ({
  age: plan.currentAge,
  year: 0,
  balance: plan.initialBalance,
  priorIncome: 0,
  priorWithdrawal: null,
  rows: [],
  beginningBalance: plan.initialBalance,
  investmentReturn: 0,
  annualContribution: 0,
  annualWithdrawal: 0,
});

/** Everything a single simulated path needs beyond the plan, the events and its RNG. */
export interface TrialConfig {
  allocation: PortfolioAllocation;
  volatility: VolatilityAssumptions;
  /**
   * The per-period step function. Defaults to the engine's own {@link runPeriod}, which is
   * the point of the design: Monte Carlo varies `returnForPeriod` and reuses the projection
   * rather than reimplementing it (ERD §5, architecture doc's `runMonteCarloTrial`).
   *
   * Overridable so a caller can fold a different stage list — the seam this ticket's tests
   * use to exercise real Story 1 math while `pipeline.ts`'s stages are still stubs.
   *
   * @internal Scaffolding, not a supported extension point. Once FIN-16's real stages land
   * there is no legitimate reason for a caller to substitute the per-period step, and the
   * mirror of this field on {@link MonteCarloOptions} should be deleted at FIN-19.
   */
  runPeriodFn?: PipelineStage;
  withdrawalStrategy?: WithdrawalStrategy;
  taxCalculator?: TaxCalculator;
}

/**
 * Simulates one path: the same per-period fold Story 1 runs, with that period's GBM draw
 * substituted for the plan's fixed `annualReturnRate`.
 *
 * Returns each year's ending balance, index 0 being `currentAge`. Contributions stay
 * rate-based and so land identically on every path (a consequence of applying the rate rule
 * per path, not a shortcut), while withdrawals are seeded from this path's own balance at
 * retirement — which is what makes sequence-of-returns risk visible.
 */
export const runMonteCarloTrial = (
  plan: PlanAssumptions,
  events: PlanEvent[],
  draw: RandomSource,
  config: TrialConfig,
): number[] => {
  const step = config.runPeriodFn ?? runPeriod;
  const withdrawalStrategy = config.withdrawalStrategy ?? withdrawFullShortfall;
  const taxCalculator = config.taxCalculator ?? zeroTax;
  const periodCount = plan.planningHorizonEndAge - plan.currentAge + 1;

  let state = createInitialPeriodState(plan);
  const balances: number[] = [];

  for (let year = 0; year < periodCount; year += 1) {
    state = step(state, {
      events,
      assumptions: plan,
      returnForPeriod: drawPortfolioReturn(
        plan.annualReturnRate,
        config.allocation,
        config.volatility,
        draw,
      ),
      withdrawalStrategy,
      taxCalculator,
    });
    balances.push(state.balance);
    state = { ...state, age: state.age + 1, year: state.year + 1 };
  }

  return balances;
};

/**
 * Historically-calibrated volatility defaults (Story 2 PRD, R5): the S&P 500's and an
 * aggregate bond index's realized annual volatility, rounded conservatively.
 */
export const DEFAULT_VOLATILITY_ASSUMPTIONS: VolatilityAssumptions = { stocks: 0.15, bonds: 0.06 };

/** Paths per run. Industry standard, and enough resolution for 10th/50th/90th percentiles. */
export const DEFAULT_SIMULATION_COUNT = 1000;

/** Knobs that are not part of the product contract: test seams and the reproducibility seed. */
export interface MonteCarloOptions {
  /**
   * Fixes the run's random draws. Omit in production — a run without a seed takes a fresh
   * one from `crypto.getRandomValues`, so every "Run stress test" click explores new
   * scenarios (ERD §5, "fresh-per-run, not cached").
   */
  seed?: number;
  /** Paths to simulate. Defaults to {@link DEFAULT_SIMULATION_COUNT}; lowered by tests. */
  simulationCount?: number;
  /**
   * See {@link TrialConfig.runPeriodFn}.
   *
   * @internal Delete at FIN-19, once the real pipeline stages remove the reason it exists.
   */
  runPeriodFn?: PipelineStage;
  withdrawalStrategy?: WithdrawalStrategy;
  taxCalculator?: TaxCalculator;
}

/** The stress-test result the UI renders (ERD §4). */
export interface MonteCarloResult {
  /** Whole percent, 0-100. */
  successRate: number;
  /** One value per projected year, `length === planningHorizonEndAge - currentAge + 1`. */
  percentiles: PercentilePaths;
  meta: {
    simulationCount: number;
    stockVolatility: number;
    bondVolatility: number;
    /** Echoes the input allocation's own 0-100 scale, not a 0-1 fraction (ERD §4). */
    allocation: { stocks: number; bonds: number };
  };
}

/**
 * Runs a full Monte Carlo simulation: 1,000 independent paths, then the success rate and
 * percentile fan across them.
 *
 * Pure and synchronous by design. The Promise-returning `runMonteCarlo(...)` the UI calls —
 * with its Worker lifecycle and cancellation state machine — wraps this function from
 * `src/workers/`, because that orchestration is impure and does not belong in `src/engine/`
 * (ERD §3, round-1 review).
 *
 * Validates the allocation, volatility, path count and seed it owns, plus the one
 * `PlanAssumptions` field it cannot run without (a horizon that ends before it starts).
 * The rest of `PlanAssumptions` is validated by Story 1's own input-boundary validator,
 * which lands with `runProjection` (FIN-16, not yet merged) and should be called from here
 * once it exists — FIN-16's branch exports it as `validatePlanAssumptions` for exactly this
 * purpose. Until that wiring lands, a caller passing, say, a negative `initialBalance` is
 * not rejected here.
 */
export const runMonteCarloTrials = (
  plan: PlanAssumptions,
  allocation: PortfolioAllocation,
  volatilityAssumptions: VolatilityAssumptions = DEFAULT_VOLATILITY_ASSUMPTIONS,
  events: PlanEvent[] = [],
  options: MonteCarloOptions = {},
): MonteCarloResult => {
  validateAllocation(allocation);
  assertFinite(volatilityAssumptions?.stocks, 'volatilityAssumptions.stocks');
  assertFinite(volatilityAssumptions?.bonds, 'volatilityAssumptions.bonds');

  assertFinite(plan?.currentAge, 'currentAge');
  assertFinite(plan?.planningHorizonEndAge, 'planningHorizonEndAge');
  if (plan.currentAge > plan.planningHorizonEndAge) {
    // Without this the fold runs zero periods, every path is `[]`, and `[].every(...)` is
    // vacuously true — so a nonsense plan would report a reassuring 100% success rate.
    throw new InvalidProjectionInputError(
      'CURRENT_AGE_EXCEEDS_HORIZON',
      `currentAge (${plan.currentAge}) must not exceed planningHorizonEndAge (${plan.planningHorizonEndAge}).`,
    );
  }

  const simulationCount = options.simulationCount ?? DEFAULT_SIMULATION_COUNT;
  assertFinite(simulationCount, 'simulationCount');
  if (!Number.isInteger(simulationCount) || simulationCount < 1) {
    throw new InvalidProjectionInputError(
      'SIMULATION_COUNT_INVALID',
      `simulationCount must be a positive whole number, received ${simulationCount}.`,
    );
  }

  const seed = options.seed ?? createRandomSeed();
  // `seed >>> 0` would quietly turn NaN into 0, handing back a fixed sequence to a caller
  // who believes they asked for a random one.
  assertFinite(seed, 'seed');
  const draw = createSeededRandom(seed);
  const config: TrialConfig = {
    allocation,
    volatility: volatilityAssumptions,
    runPeriodFn: options.runPeriodFn,
    withdrawalStrategy: options.withdrawalStrategy,
    taxCalculator: options.taxCalculator,
  };

  const balancesByPath = Array.from({ length: simulationCount }, () =>
    runMonteCarloTrial(plan, events, draw, config),
  );

  return {
    successRate: computeSuccessRate(balancesByPath),
    percentiles: extractPercentiles(balancesByPath),
    meta: {
      simulationCount,
      stockVolatility: volatilityAssumptions.stocks,
      bondVolatility: volatilityAssumptions.bonds,
      allocation: { stocks: allocation.stocksPercent, bonds: allocation.bondsPercent },
    },
  };
};
