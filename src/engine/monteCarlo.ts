/**
 * Monte Carlo simulation core (Story 2, ERD §5).
 *
 * Pure and synchronous throughout: no worker, no Promise, no I/O. The Web Worker that runs
 * this off the main thread and owns cancellation is a separate layer outside `src/engine/`
 * (ERD §3, round-1 review) — it wraps {@link runMonteCarloTrials} rather than replacing it.
 */

import { InvalidProjectionInputError } from './errors';
import { HISTORICAL_ANNUAL_RETURNS } from './historicalReturns';
import type { HistoricalYearReturn } from './historicalReturns';
import { HISTORICAL_ANNUAL_INFLATION } from './inflationData';
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
 * **RESOLVED (2026-08-18, Travis) — `annualReturnRate` is the expected (arithmetic) return,
 * not the GBM log-drift.** ERD §5's formula used the user's rate directly as `mu` in the
 * exponent, but under GBM `E[R] = exp(mu) - 1`, so a plan that says "7% return" actually had
 * an expected return of 7.2508% — diverging further from Story 1's plain-arithmetic Tier 1
 * line at longer horizons (~7.3% at 30 years, ~16.7% at 66, lump-sum case).
 *
 * This function itself still takes `meanReturn` as the log-drift `mu` — that is the correct
 * GBM formula and stays as-is. The conversion happens at the call site
 * (`runMonteCarloTrial`'s `drawPortfolioReturn(Math.log(1 + plan.annualReturnRate), ...)`),
 * which turns the plan's arithmetic-mean input into the log-drift this function expects, so
 * `E[R]` over one period comes back out to exactly `plan.annualReturnRate`.
 *
 * Rationale: this matches standard Monte Carlo retirement-planning practice — feed the
 * simulation the arithmetic mean return so the simulation's own randomness produces the
 * volatility drag, rather than pre-baking a geometric mean into the input and double-counting
 * that drag (see Kitces, "Volatility Drag: How Variance Drains Investment Returns").
 */
export const gbmPeriodReturn = (meanReturn: number, volatility: number, deviate: number): number =>
  Math.exp(
    (meanReturn - (volatility * volatility) / 2) * PERIOD_YEARS +
      volatility * Math.sqrt(PERIOD_YEARS) * deviate,
  ) - 1;

/**
 * Two correlated standard normal deviates `[stockZ, bondZ]`, via a 2x2 Cholesky decomposition:
 * `bondZ = correlation * stockZ + sqrt(1 - correlation^2) * independentZ`.
 *
 * `correlation` in `[-1, 1]`. At `0` this degenerates to two independent deviates (the
 * pre-FIN-56 behavior); at `-1`/`1` `bondZ` becomes an exact mirror/copy of `stockZ`.
 * Consumes two calls to {@link standardNormal} (four uniform draws total).
 */
export const correlatedNormals = (draw: RandomSource, correlation: number): [number, number] => {
  const stockZ = standardNormal(draw);
  const independentZ = standardNormal(draw);
  const bondZ = correlation * stockZ + Math.sqrt(1 - correlation * correlation) * independentZ;

  return [stockZ, bondZ];
};

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

/**
 * Everything one simulated path knows about itself. Nominal balances, the price level it
 * lived through, and whether it went broke.
 *
 * The three travel together because they are only meaningful together (FIN-65 change 3).
 * Each path draws its own historical sequence, so each has its OWN realised inflation — a
 * single run has as many CPI series as it has paths, and there is no run-level series that
 * could deflate a percentile line after the fact. Deflation has to happen per path, before
 * anything is ranked. `ruinPeriod` has to be carried for the same reason: change 4 clamps a
 * broke path to zero, which erases the negative balances ruin used to be inferred from.
 */
export interface TrialPath {
  /** Nominal (future-dollar) ending balance per year, index 0 being `currentAge`. */
  balances: PathBalances;
  /**
   * Cumulative price level at the END of each year, relative to today = 1. `balances[i] /
   * inflationIndex[i]` is that year's balance in today's dollars.
   */
  inflationIndex: readonly number[];
  /**
   * Index of the first year this path's balance hit zero, or `null` if it never did. Zero is
   * absorbing, so every later balance is zero too.
   */
  ruinPeriod: number | null;
}

/**
 * Restates a path's nominal balances in today's dollars, deflating each year by the price
 * level THAT path lived through.
 *
 * Must be applied before {@link extractPercentiles}, never after: percentile lines are built
 * cross-sectionally, so deflating the finished line would divide a p50 assembled from many
 * different paths by one arbitrary path's inflation. Paths also re-rank under deflation — a
 * nominally larger balance earned through harsher inflation can be the smaller one in real
 * terms — so real p50 is genuinely not deflated nominal p50.
 */
export const toTodaysDollars = (path: TrialPath): number[] =>
  path.balances.map((balance, year) => balance / path.inflationIndex[year]);

/** The percentile fan in both units, from a single run (FIN-65 change 3). */
export interface PercentileViews {
  /** Today's dollars — what the UI shows by default. */
  real: PercentilePaths;
  /** Future dollars, as simulated. Retained for a future nominal-view toggle. */
  nominal: PercentilePaths;
}

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
 * Share of paths that never ran dry, as a whole percentage 0-100 (ERD §5).
 *
 * Reads `ruinPeriod` rather than the sign of any balance. This is load-bearing, not a
 * refactor: before FIN-65 change 4 a broke path kept withdrawing into ever-deeper negatives,
 * and success was `path.every((balance) => balance >= 0)`. Change 4 clamps ruin at zero, so
 * that predicate is now true of EVERY path and would report a reassuring 100% on a batch
 * where every single portfolio went bankrupt. Ruin is recorded when it happens because the
 * evidence for it no longer survives in the numbers.
 *
 * Ruin at any point is terminal: a plan that recovers by the horizon after running dry
 * mid-retirement is still a failed plan — and under the absorbing clamp it cannot recover.
 */
export const computeSuccessRate = (paths: readonly TrialPath[]): number => {
  // No paths means nothing succeeded. `runMonteCarloTrials` rejects an empty batch before
  // reaching here, but the naked division would otherwise hand the UI a NaN success rate.
  if (paths.length === 0) {
    return 0;
  }

  const successes = paths.filter((path) => path.ruinPeriod === null).length;

  return Math.round((100 * successes) / paths.length);
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

  if (allocation.stocksPercent < 0 || allocation.bondsPercent < 0) {
    throw new InvalidProjectionInputError(
      'ALLOCATION_ZERO_WEIGHT',
      `allocation must not put negative weight on stocks or bonds, received ${allocation.stocksPercent}% stocks and ${allocation.bondsPercent}% bonds`,
    );
  }
};

/** Annual volatility per asset class, as decimals (ERD §5, R5). */
export interface VolatilityAssumptions {
  stocks: number;
  bonds: number;
}

/** Expected (arithmetic) annual return per asset class, as decimals — the counterpart to
 * {@link VolatilityAssumptions} (ERD §5, FIN-56). */
export interface ReturnAssumptions {
  stocks: number;
  bonds: number;
}

/**
 * Historically-calibrated expected-return defaults (FIN-64).
 *
 * Long-run nominal arithmetic mean annual return, large-cap U.S. stocks vs.
 * intermediate-term U.S. government bonds, 1926-2023 (Ibbotson SBBI / Damodaran's published
 * "Historical Returns on Stocks, Bonds and Bills" series). Arithmetic, not geometric/CAGR —
 * that is what {@link gbmPeriodReturn}'s `mu` expects so the simulation's own draws produce
 * the volatility drag rather than double-counting it (see that function's doc comment).
 *
 * Deliberately the same dataset lineage Bengen's original 4%-rule research drew from, not a
 * forward-looking (CAPE-adjusted) estimate: FIN-64 exists to make this engine's Monte Carlo
 * success rate agree with Bengen's finding, and a forward-looking haircut would intentionally
 * defeat that by construction. Paired with {@link DEFAULT_VOLATILITY_ASSUMPTIONS} from the
 * same source — bumping the mean while leaving volatility at FIN-56's more conservative
 * figures overstates success (verified: it pushes a textbook 30yr/4% case to ~98%, well past
 * Bengen's ~90-95%).
 */
export const DEFAULT_RETURN_ASSUMPTIONS: ReturnAssumptions = { stocks: 0.115, bonds: 0.05 };

/**
 * Fixed stock/bond correlation (FIN-56): mild negative, the standard "flight to quality"
 * effect where bonds tend to hold up (or rally) when stocks fall, and vice versa. -0.2 sits
 * in the commonly-cited -0.1 to -0.3 range for long-run US stock/bond correlation and is
 * deliberately not user-configurable — like volatility, it is a modeling assumption rather
 * than a plan input. Before FIN-56 the two assets were drawn fully independently (correlation
 * 0), which understated how often a bad stock year and a bad bond year coincide less than
 * they empirically do — the two assets moved as if in separate, unrelated worlds.
 */
export const DEFAULT_CORRELATION = -0.2;

/**
 * One period's portfolio return: a correlated GBM draw per asset class (via
 * {@link correlatedNormals}, fixed correlation `correlation`), blended by allocation weight.
 * Consumes four uniform draws — two per Box-Muller deviate.
 *
 * Each asset class gets its own expected return in `returnAssumptions`, converted from
 * arithmetic mean to GBM log-drift (`ln(1 + rate)`) the same way the single blended rate used
 * to be converted at the call site — see the resolved OPEN DECISION comment on
 * {@link gbmPeriodReturn}.
 */
export const drawPortfolioReturn = (
  returnAssumptions: ReturnAssumptions,
  allocation: PortfolioAllocation,
  volatility: VolatilityAssumptions,
  correlation: number,
  draw: RandomSource,
): number => {
  const [stockZ, bondZ] = correlatedNormals(draw, correlation);

  return blendedPortfolioReturn(
    allocation,
    gbmPeriodReturn(Math.log(1 + returnAssumptions.stocks), volatility.stocks, stockZ),
    gbmPeriodReturn(Math.log(1 + returnAssumptions.bonds), volatility.bonds, bondZ),
  );
};

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

/**
 * Which per-period return model a trial draws from (FIN-64):
 *
 * - `'historical'` (the production default): block-bootstrap resampling of real annual
 *   returns from {@link HISTORICAL_ANNUAL_RETURNS} — see {@link createHistoricalReturnGenerator}.
 * - `'gbm'`: the original independent lognormal draw per period ({@link drawPortfolioReturn}),
 *   kept for the tests that specifically validate that formula in isolation.
 */
export type ReturnModel = 'historical' | 'gbm';

/**
 * Contiguous run length, in years, that a block-bootstrap draw copies out of history before
 * picking a fresh random start point (FIN-64).
 *
 * Chosen in the commonly-used 3-10 year range for block-bootstrap retirement simulations: long
 * enough to carry forward a real multi-year sequence (bear-market-into-recovery, the mean-
 * reversion structure {@link ReturnModel}'s `'historical'` mode exists to preserve — see the
 * `DEFAULT_RETURN_ASSUMPTIONS` doc comment's citation), short enough that a 98-year dataset
 * still yields many distinct block-start points to combine (94 possible starts at length 5),
 * so 5,000+ simulated paths remain meaningfully different from each other rather than repeating
 * the same handful of historical windows.
 */
export const DEFAULT_BLOCK_LENGTH_YEARS = 5;

/**
 * Builds a per-path return stream from real history instead of an independent lognormal draw
 * (FIN-64) — the block-bootstrap technique Trinity's own rolling-window study and tools like
 * ProjectionLab's "historical" mode use, chosen specifically because independent-per-year draws
 * assume zero serial correlation between consecutive years, while real returns mean-revert
 * (a bad decade tends to be followed by a recovery, not by more independently-bad decades).
 * Parametric Monte Carlo without this produces both unrealistically catastrophic failure paths
 * and unrealistically enormous success paths that no rolling window of actual market history
 * ever produced (Kitces/Tharp/Fitzpatrick, "Fat Tails In Monte Carlo Analysis vs Safe
 * Withdrawal Rates").
 *
 * Returns a closure that, called once per period, hands back that period's real historical
 * stock/bond returns. Internally walks forward through a `blockLength`-year slice of
 * {@link HISTORICAL_ANNUAL_RETURNS} starting at a random year; once the slice is exhausted it
 * draws a fresh random start and continues — so a single path is a concatenation of several
 * real historical multi-year runs, not one continuous 30-40 year historical window (there are
 * nowhere near enough non-overlapping ones to feed 5,000+ simulations).
 */
export const createHistoricalReturnGenerator = (
  draw: RandomSource,
  data: readonly HistoricalYearReturn[] = HISTORICAL_ANNUAL_RETURNS,
  blockLength: number = DEFAULT_BLOCK_LENGTH_YEARS,
): (() => HistoricalYearReturn) => {
  let block: readonly HistoricalYearReturn[] = [];
  let index = 0;

  return () => {
    if (index >= block.length) {
      const maxStart = data.length - blockLength;
      const start = Math.floor(draw() * (maxStart + 1));
      block = data.slice(start, start + blockLength);
      index = 0;
    }

    const yearReturn = block[index];
    index += 1;
    return yearReturn;
  };
};

/**
 * Year -> realised CPI-U, built once at module load rather than per period (FIN-65).
 *
 * A linear scan of a 98-entry array inside the trial loop would run 5,000 paths x 65 periods
 * x ~49 comparisons for a lookup that never changes; the `performance` budget in
 * `monteCarlo.test.ts` exists to catch exactly this class of per-period work.
 */
const INFLATION_BY_YEAR: ReadonlyMap<number, number> = new Map(
  HISTORICAL_ANNUAL_INFLATION.map((entry) => [entry.year, entry.inflation]),
);

/**
 * This historical year's realised CPI-U.
 *
 * `HISTORICAL_ANNUAL_INFLATION` is deliberately year-range-matched to
 * {@link HISTORICAL_ANNUAL_RETURNS}, and `inflationData.test.ts` pins that, so every year the
 * return generator can draw is present. Returning `undefined` for an unknown year rather than
 * substituting a rate keeps a future mismatch visible as the plan's fixed inflation showing up
 * in a historical trial, instead of a silently invented number.
 *
 * Callers pass the year drawn in the PREVIOUS period, never `drawnYear - 1` — see
 * {@link runMonteCarloTrial}. That is what keeps every lookup inside the table: 1928 is the
 * first year of both, so `1928 - 1` has no entry, while a previously-drawn year always does.
 */
const inflationForYear = (year: number): number | undefined => INFLATION_BY_YEAR.get(year);

/** Everything a single simulated path needs beyond the plan, the events and its RNG. */
export interface TrialConfig {
  allocation: PortfolioAllocation;
  volatility: VolatilityAssumptions;
  /** Per-asset-class expected return and the fixed stock/bond correlation (FIN-56) — see
   * {@link DEFAULT_RETURN_ASSUMPTIONS} and {@link DEFAULT_CORRELATION}. Only consulted when
   * `returnModel` is `'gbm'`; the `'historical'` default ignores it in favor of real data. */
  returnAssumptions: ReturnAssumptions;
  correlation: number;
  /** See {@link ReturnModel}. Defaults to `'historical'` in {@link runMonteCarloTrials}. */
  returnModel?: ReturnModel;
  /** See {@link DEFAULT_BLOCK_LENGTH_YEARS}. Only consulted when `returnModel` is `'historical'`. */
  blockLengthYears?: number;
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
): TrialPath => {
  const step = config.runPeriodFn ?? runPeriod;
  const withdrawalStrategy = config.withdrawalStrategy ?? withdrawFullShortfall;
  const taxCalculator = config.taxCalculator ?? zeroTax;
  const periodCount = plan.planningHorizonEndAge - plan.currentAge + 1;

  // One generator per path (not per period): a block-bootstrap path is a single continuous
  // walk through history that persists its position across periods, unlike the GBM branch
  // where each period is an independent draw (FIN-64) — see `createHistoricalReturnGenerator`.
  const nextHistoricalYear =
    (config.returnModel ?? 'historical') === 'historical'
      ? createHistoricalReturnGenerator(draw, HISTORICAL_ANNUAL_RETURNS, config.blockLengthYears)
      : null;

  let state = createInitialPeriodState(plan);
  const balances: number[] = [];

  /**
   * Cumulative price level at the end of each period, today = 1 (FIN-65 change 3). Built from
   * the SAME drawn years as the returns, so a path's inflation is the inflation it actually
   * lived through — the whole point of sampling returns and CPI jointly.
   *
   * Note this uses the CURRENT period's drawn year, not the lagged `priorHistoricalYear` the
   * withdrawal indexes off. The two are different questions and must not be conflated:
   * "how much had prices risen by the end of year N" is a fact about year N, while "what
   * raise does this year's budget get" is a fact the retiree could only have known a year
   * earlier. Sharing one variable between them was tempting and would have been wrong.
   */
  const inflationIndex: number[] = [];
  let priceLevel = 1;

  /** First period this path's balance hit zero — see {@link TrialPath.ruinPeriod}. */
  let ruinPeriod: number | null = null;

  /**
   * The historical year drawn in the PREVIOUS period, whose CPI-U indexes this period's
   * withdrawal (FIN-65 change 3). `null` for the first period, which has no previous one.
   */
  let priorHistoricalYear: HistoricalYearReturn | null = null;

  for (let year = 0; year < periodCount; year += 1) {
    const historicalYear = nextHistoricalYear?.();
    const returnForPeriod = historicalYear
      ? blendedPortfolioReturn(config.allocation, historicalYear.stockReturn, historicalYear.bondReturn)
      : // Per-asset-class expected return/correlation (FIN-56) rather than the plan's single
        // blended `annualReturnRate` — see `drawPortfolioReturn`'s doc comment.
        drawPortfolioReturn(
          config.returnAssumptions,
          config.allocation,
          config.volatility,
          config.correlation,
          draw,
        );

    state = step(state, {
      events,
      assumptions: plan,
      returnForPeriod,
      // FIN-65: the drawn historical years supply both the nominal returns and the
      // cost-of-living increases, so the two series come from one sampler — no second
      // sampler, no second RNG draw (which would also have shifted every existing seeded
      // expectation for unrelated reasons), and no way for them to drift apart.
      //
      // The CPI is lagged one period (change 3). Bengen (1994) and Trinity index a year's
      // withdrawal to the PRIOR year's realised CPI, because a retiree setting their 1967
      // budget in January 1967 does not yet know what 1967's inflation will be. Change 1
      // originally used the current drawn year, which put the 1966 cohort's 30-year terminal
      // ~$590K below Bengen's on a $1M portfolio; lagging it reproduces Bengen exactly.
      //
      // WHICH prior year, though — two readings diverge at a bootstrap block seam:
      //   (a) the calendar year before the drawn year (`year - 1`), or
      //   (b) the year drawn in the previous PERIOD, i.e. the lag follows the sampled path.
      // This is (b), and it is a modelling choice rather than an implementation detail. On an
      // unbroken chronological run the two are identical, so both reproduce Bengen on the
      // case the tests pin; they part company only at a seam. (b) wins there because the
      // simulated retiree's budget should follow the inflation this PATH lived through, not a
      // calendar year the path never visited — and because (a) is not even well defined at
      // the edge: a block starting at 1928 would need 1927, which is in neither table.
      //
      // Left `undefined` on the GBM branch, which has no historical year to key off, and on
      // the first period, which has no previous one. Both fall back to `plan.inflationRate`
      // inside `computeWithdrawals`, as does the deterministic projection — see that stage's
      // comment on the `??`. The first-period fallback is inert either way: the opening
      // retirement withdrawal is `withdrawalRateInRetirement * beginningBalance`, which never
      // reads an inflation rate at all.
      inflationForPeriod: priorHistoricalYear ? inflationForYear(priorHistoricalYear.year) : undefined,
      withdrawalStrategy,
      taxCalculator,
    });
    // FIN-65 change 4. A portfolio cannot go below zero: once it is spent, it is spent, and
    // the old behaviour — withdrawing from a negative balance, so a good return year made the
    // hole DEEPER — produced chart tails in the negative millions that were an artifact of the
    // arithmetic rather than anything a retiree could experience. Zero absorbs: once ruined,
    // ruined, and later contributions cannot resurrect a plan that already failed.
    if (ruinPeriod === null && state.balance <= 0) {
      ruinPeriod = year;
    }
    const balance = ruinPeriod === null ? state.balance : 0;

    // Neither write moves this trial's OWN output — `ruinPeriod` already forces every later
    // reported balance to zero, and nothing here reads `state.rows` back. What they protect is
    // the state handed to caller-injected stages: `runPeriodFn`, `withdrawalStrategy` and
    // `taxCalculator` are all first-class `TrialConfig` fields, and they observe this state
    // directly. Without the clamp a ruined path feeds them a balance that keeps compounding
    // downward (measured: -$3,838,333 by the horizon on a plan that ruins at period 2) while
    // the reported series says zero — a split-brain a real bracketed tax calculator or
    // guardrail withdrawal strategy would act on. `rows` is patched for the same reason: it is
    // the same year's ending balance, and the two disagreeing is the kind of contradiction a
    // later reader would trust the wrong half of. Both are pinned by tests through the injected
    // stage seam, so this is behaviour under test, not merely a convention.
    state = { ...state, balance };
    const lastRow = state.rows[state.rows.length - 1];
    if (lastRow !== undefined && lastRow.endingBalance !== balance) {
      state = {
        ...state,
        rows: [...state.rows.slice(0, -1), { ...lastRow, endingBalance: balance }],
      };
    }

    balances.push(balance);

    // Deliberately NOT `continue`-ing or breaking out once ruined. `runMonteCarloTrials`
    // shares one RNG stream across every path in the batch, so a trial that stopped drawing
    // early would shift every path after it — a change in one plan's bankruptcy would
    // silently move percentiles that have nothing to do with it. A ruined path keeps
    // stepping and keeps drawing; it just stays at zero.
    // `inflationForYear` can miss: the return table and the CPI table are separate sources and
    // need not span identical ranges. Falling back to the plan's assumed rate matches what
    // `computeWithdrawals` does with the same gap, so the index and the withdrawals stay
    // consistent rather than one silently treating a missing year as zero inflation.
    const realisedInflation =
      (historicalYear ? inflationForYear(historicalYear.year) : undefined) ?? plan.inflationRate;
    priceLevel *= 1 + realisedInflation;
    inflationIndex.push(priceLevel);

    state = { ...state, age: state.age + 1, year: state.year + 1 };
    priorHistoricalYear = historicalYear ?? null;
  }

  return { balances, inflationIndex, ruinPeriod };
};

/**
 * Historically-calibrated volatility defaults (FIN-64): realized annual standard deviation
 * over the same 1926-2023 Ibbotson SBBI / Damodaran window as
 * {@link DEFAULT_RETURN_ASSUMPTIONS}, large-cap U.S. stocks vs. intermediate-term U.S.
 * government bonds — a matched mean/volatility pair from one source, not this figure alone.
 * FIN-56's original 15%/6% pair undercounted historical volatility, which is what let the
 * mean-return bump alone push success past Bengen's ~90-95% band (see that constant's doc
 * comment).
 */
export const DEFAULT_VOLATILITY_ASSUMPTIONS: VolatilityAssumptions = { stocks: 0.195, bonds: 0.077 };

/** Paths per run. Industry standard, and enough resolution for 10th/50th/90th percentiles. */
export const DEFAULT_SIMULATION_COUNT = 5000;

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
  /** Expected return per asset class. Defaults to {@link DEFAULT_RETURN_ASSUMPTIONS}. */
  returnAssumptions?: ReturnAssumptions;
  /** Stock/bond correlation. Defaults to {@link DEFAULT_CORRELATION}; a test seam only —
   * production code should rely on the default (FIN-56: not a user-facing plan input). Only
   * consulted when `returnModel` is `'gbm'`. */
  correlation?: number;
  /** See {@link ReturnModel}. Defaults to `'historical'`. */
  returnModel?: ReturnModel;
  /** See {@link DEFAULT_BLOCK_LENGTH_YEARS}. Only consulted when `returnModel` is `'historical'`. */
  blockLengthYears?: number;
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
  /**
   * One value per projected year, `length === planningHorizonEndAge - currentAge + 1`, in
   * both units.
   *
   * Split into `{ real, nominal }` rather than left as a bare fan (FIN-65 change 3) so that
   * no display site can render a number without having said which dollars it is in. The
   * break is intentional: the compiler enumerating every consumer is cheaper than one chart
   * quietly plotting future dollars under a today's-dollars axis label.
   */
  percentiles: PercentileViews;
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
    returnAssumptions: options.returnAssumptions ?? DEFAULT_RETURN_ASSUMPTIONS,
    correlation: options.correlation ?? DEFAULT_CORRELATION,
    returnModel: options.returnModel,
    blockLengthYears: options.blockLengthYears,
    runPeriodFn: options.runPeriodFn,
    withdrawalStrategy: options.withdrawalStrategy,
    taxCalculator: options.taxCalculator,
  };

  const paths = Array.from({ length: simulationCount }, () =>
    runMonteCarloTrial(plan, events, draw, config),
  );

  return {
    successRate: computeSuccessRate(paths),
    // Each fan is ranked in its own units. Deflating the nominal fan instead would be both
    // cheaper and wrong — see {@link toTodaysDollars}.
    percentiles: {
      real: extractPercentiles(paths.map(toTodaysDollars)),
      nominal: extractPercentiles(paths.map((path) => path.balances)),
    },
    meta: {
      simulationCount,
      stockVolatility: volatilityAssumptions.stocks,
      bondVolatility: volatilityAssumptions.bonds,
      allocation: { stocks: allocation.stocksPercent, bonds: allocation.bondsPercent },
    },
  };
};
