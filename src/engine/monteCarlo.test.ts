import { describe, expect, it } from 'vitest';

import { InvalidProjectionInputError } from './errors';
import {
  blendedPortfolioReturn,
  computeSuccessRate,
  correlatedNormals,
  createInitialPeriodState,
  createRandomSeed,
  createSeededRandom,
  DEFAULT_CORRELATION,
  DEFAULT_RETURN_ASSUMPTIONS,
  DEFAULT_VOLATILITY_ASSUMPTIONS,
  drawPortfolioReturn,
  extractPercentiles,
  gbmPeriodReturn,
  runMonteCarloTrial,
  runMonteCarloTrials,
  standardNormal,
  toTodaysDollars,
  validateAllocation,
} from './monteCarlo';
import type { TrialConfig, TrialPath } from './monteCarlo';
import { withdrawFullShortfall, zeroTax } from './strategies';
import { pipelineStages, runPeriod } from './pipeline';
import { HISTORICAL_ANNUAL_RETURNS } from './historicalReturns';
import { HISTORICAL_ANNUAL_INFLATION } from './inflationData';
import type { PeriodState, PipelineStage, PlanAssumptions, ProjectionRow } from './types';

/** This year's S&P 500 total return from our own Damodaran table. */
const yearStockReturn = (year: number): number => {
  const entry = HISTORICAL_ANNUAL_RETURNS.find((candidate) => candidate.year === year);
  if (entry === undefined) throw new Error(`no return data for ${year}`);
  return entry.stockReturn;
};

/** This year's realised CPI-U from our own Minneapolis Fed table. */
const yearCpi = (year: number): number => {
  const entry = HISTORICAL_ANNUAL_INFLATION.find((candidate) => candidate.year === year);
  if (entry === undefined) throw new Error(`no CPI data for ${year}`);
  return entry.inflation;
};

const assumptions = (overrides: Partial<PlanAssumptions> = {}): PlanAssumptions => ({
  currentAge: 35,
  retirementAge: 67,
  initialBalance: 100_000,
  currentAnnualIncome: 80_000,
  annualContributionRate: 0.15,
  annualRaiseRate: 0.03,
  annualReturnRate: 0.07,
  inflationRate: 0.025,
  withdrawalRateInRetirement: 0.04,
  planningHorizonEndAge: 100,
  ...overrides,
});

const allocation70_30 = { stocksPercent: 70, bondsPercent: 30 };

/**
 * The Story 1 per-period math from ERD §5, standing in for `pipeline.ts`'s stages while
 * those are still identity stubs (FIN-16 owns filling them in, in parallel with this work).
 *
 * Without it, every assertion about success rates, percentile spread or accuracy would run
 * against a projection where the balance never moves — vacuously true. Monte Carlo calls the
 * step function polymorphically (ERD §10, WP-2), so substituting it here is exactly the
 * substitution the design promises, not a workaround. FIN-19 swaps the real stages in.
 */
const referenceRunPeriod: PipelineStage = (state, input) => {
  const plan = input.assumptions;
  const beginningBalance = state.balance;
  const retired = state.age >= plan.retirementAge;

  const income = retired
    ? 0
    : state.year === 0
      ? plan.currentAnnualIncome
      : state.priorIncome * (1 + plan.annualRaiseRate);
  const annualContribution = retired ? 0 : income * plan.annualContributionRate;

  const requestedWithdrawal = !retired
    ? 0
    : state.priorWithdrawal === null
      ? beginningBalance * plan.withdrawalRateInRetirement
      : // FIN-65: mirrors `computeWithdrawals`' fallback exactly. This stand-in only stays
        // useful as long as it is a faithful mirror of the real stage, so it takes the
        // period's own inflation when Monte Carlo's historical path supplies one.
        state.priorWithdrawal * (1 + (input.inflationForPeriod ?? plan.inflationRate));
  const sourced = input.withdrawalStrategy(state, requestedWithdrawal).amount;
  const taxOwed = input.taxCalculator(income, sourced, { age: state.age, year: state.year }).taxOwed;

  // FIN-65 change 2: the withdrawal comes out before the year's growth is applied, so the
  // year's return is earned on `beginningBalance - sourced`. Contributions still land after
  // growth and earn nothing in the year they are made (ERD §5), unchanged.
  const investmentReturn = (beginningBalance - sourced) * input.returnForPeriod;

  const endingBalance =
    beginningBalance - sourced + investmentReturn + annualContribution - taxOwed;

  return {
    ...state,
    balance: endingBalance,
    beginningBalance,
    investmentReturn,
    priorIncome: income,
    priorWithdrawal: retired ? requestedWithdrawal : state.priorWithdrawal,
    rows: [
      ...state.rows,
      {
        age: state.age,
        year: state.year,
        beginningBalance,
        annualContribution,
        investmentReturn,
        annualWithdrawal: sourced,
        endingBalance,
      },
    ],
  };
};

/**
 * `returnAssumptions`/`correlation` default to the same mean for both assets and zero
 * correlation — i.e. exactly the pre-FIN-56 behavior — so every existing test built on this
 * helper keeps its original expected numbers unless it opts into the new split-return/
 * correlated-draw behavior explicitly.
 */
const trialConfig = (overrides: Partial<TrialConfig> = {}): TrialConfig => ({
  allocation: allocation70_30,
  volatility: { stocks: 0.15, bonds: 0.06 },
  returnAssumptions: { stocks: 0.07, bonds: 0.07 },
  correlation: 0,
  // This whole suite exercises the GBM draw's math directly (fixed mean/volatility, specific
  // seeded values) — FIN-64's block-bootstrap `'historical'` default ignores those inputs
  // entirely, so every test built on this helper opts back into `'gbm'` explicitly.
  returnModel: 'gbm',
  runPeriodFn: referenceRunPeriod,
  ...overrides,
});

/** Feeds {@link standardNormal} exactly the uniforms a test wants, in order. */
const uniforms = (...values: number[]) => {
  let index = 0;
  return () => values[index++];
};

/** The `.code` of the {@link InvalidProjectionInputError} an action throws. */
const codeThrownBy = (act: () => unknown): string => {
  try {
    act();
  } catch (error) {
    if (error instanceof InvalidProjectionInputError) {
      return error.code;
    }
    throw error;
  }
  throw new Error('expected an InvalidProjectionInputError, but nothing was thrown');
};

describe('createSeededRandom', () => {
  it('produces the same sequence twice from the same seed', () => {
    const first = createSeededRandom(12345);
    const second = createSeededRandom(12345);

    const firstDraws = [first(), first(), first(), first(), first()];
    const secondDraws = [second(), second(), second(), second(), second()];

    expect(secondDraws).toEqual(firstDraws);
  });

  it('produces a different sequence from a different seed', () => {
    const first = createSeededRandom(1);
    const second = createSeededRandom(2);

    expect([second(), second(), second()]).not.toEqual([first(), first(), first()]);
  });

  it('draws values in [0, 1)', () => {
    const draw = createSeededRandom(99);

    for (let i = 0; i < 10_000; i += 1) {
      const value = draw();

      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  /**
   * Catches a generator with a period shorter than one run's worth of draws, which would
   * silently recycle the same market scenario across paths. A full run draws 4 uniforms per
   * period (two Box-Muller pairs) over at most 66 periods for each of 1,000 paths.
   *
   * The bound is not 100% distinct: mulberry32's output is 32 bits wide, so ~8 birthday
   * collisions are expected among 264,000 draws even from a perfect generator. Any real
   * cycling collapses the count by orders of magnitude, not by dozens.
   */
  it('does not cycle within a full 66-year, 1000-path run of draws', () => {
    const draw = createSeededRandom(7);
    const seen = new Set<number>();

    for (let i = 0; i < 264_000; i += 1) {
      seen.add(draw());
    }

    expect(seen.size).toBeGreaterThan(263_000);
  });
});

describe('createRandomSeed', () => {
  it('returns a fresh seed each call, so an unseeded run varies', () => {
    const seeds = new Set(Array.from({ length: 100 }, () => createRandomSeed()));

    expect(seeds.size).toBeGreaterThan(90);
  });

  it('returns a seed the PRNG accepts, spread across the full 32-bit range', () => {
    const seeds = Array.from({ length: 200 }, () => createRandomSeed());

    for (const seed of seeds) {
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(4_294_967_296);
    }
    // A truncating implementation (e.g. seeding from a small counter) clusters low.
    expect(Math.max(...seeds)).toBeGreaterThan(2_000_000_000);
  });
});

describe('standardNormal', () => {
  /**
   * Box-Muller: `z = sqrt(-2 ln u1) * cos(2*pi*u2)`, with `u1 = 1 - draw()` so `u1` lands in
   * `(0, 1]` and `ln u1` can never be `-Infinity`. Expected values below are hand-computed
   * from that formula, not read back out of the implementation.
   */
  it('transforms a uniform pair into the hand-computed normal deviate', () => {
    // u1 = 0.5, u2 = 0 -> sqrt(2 ln 2) * cos(0)
    expect(standardNormal(uniforms(0.5, 0))).toBeCloseTo(1.1774100225154747, 12);
  });

  it('returns a negative deviate when the angle draw flips the cosine', () => {
    // u1 = 0.25, u2 = 0.5 -> sqrt(2 ln 4) * cos(pi)
    expect(standardNormal(uniforms(0.75, 0.5))).toBeCloseTo(-1.6651092223153954, 12);
  });

  it('stays finite when the uniform draw is exactly zero', () => {
    // draw() may legitimately return 0; a naive `Math.log(u)` on that value is -Infinity.
    expect(standardNormal(uniforms(0, 0))).toBeCloseTo(0, 12);
    expect(Number.isFinite(standardNormal(uniforms(0, 0.5)))).toBe(true);
  });

  it('draws from a distribution with mean 0 and standard deviation 1', () => {
    const draw = createSeededRandom(4242);
    const sampleSize = 200_000;
    const samples = Array.from({ length: sampleSize }, () => standardNormal(draw));

    const mean = samples.reduce((sum, value) => sum + value, 0) / sampleSize;
    const variance = samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (sampleSize - 1);

    expect(mean).toBeCloseTo(0, 2);
    expect(Math.sqrt(variance)).toBeCloseTo(1, 2);
  });
});

/**
 * `R[t] = exp((mu - sigma^2 / 2) * dt + sigma * sqrt(dt) * Z) - 1`, `dt = 1` year (ERD §5).
 * Expected values are that formula evaluated independently, not read back out of the module.
 */
describe('gbmPeriodReturn', () => {
  it('returns the median drift when the normal draw is zero', () => {
    // exp(0.07 - 0.15^2 / 2) - 1
    expect(gbmPeriodReturn(0.07, 0.15, 0)).toBeCloseTo(0.06051008007643799, 12);
  });

  it('shifts the return up by one volatility unit for a +1 draw', () => {
    // exp(0.07 - 0.01125 + 0.15) - 1
    expect(gbmPeriodReturn(0.07, 0.15, 1)).toBeCloseTo(0.23213692579131928, 12);
  });

  it('produces a loss for a two-sigma downward draw', () => {
    // exp(0.07 - 0.01125 - 0.30) - 1
    expect(gbmPeriodReturn(0.07, 0.15, -2)).toBeCloseTo(-0.214354809462747, 12);
  });

  it('applies the smaller variance drag at bond volatility', () => {
    // exp(0.07 - 0.06^2 / 2) - 1 — larger than the stock median for the same mean return
    expect(gbmPeriodReturn(0.07, 0.06, 0)).toBeCloseTo(0.0705794029492035, 12);
  });

  it('collapses to the deterministic drift when volatility is zero', () => {
    // With no volatility the draw cannot matter: exp(mu) - 1 for every Z.
    expect(gbmPeriodReturn(0.07, 0, 3)).toBeCloseTo(0.07250818125421654, 12);
    expect(gbmPeriodReturn(0.07, 0, -3)).toBeCloseTo(0.07250818125421654, 12);
  });

  /**
   * `gbmPeriodReturn` itself always takes `meanReturn` as GBM log-drift `mu` and produces an
   * expected return of `exp(mu) - 1` — that part of the formula is correct GBM and unchanged.
   * The mean-return convention fix (FIN-17, resolved 2026-08-18) lives at the call site in
   * `runMonteCarloTrial`, which now converts the plan's arithmetic `annualReturnRate` into
   * this function's `mu` via `ln(1 + rate)` before calling it. This test pins that this
   * function's own contract stays log-drift-in, so that conversion stays visible at the call
   * site rather than getting silently duplicated or dropped here.
   */
  it('takes meanReturn as GBM log-drift, so the expected return is exp(mu) - 1', () => {
    const expectedReturn = gbmPeriodReturn(0.07, 0, 0);

    expect(expectedReturn).toBeCloseTo(Math.exp(0.07) - 1, 12);
    expect(expectedReturn).not.toBeCloseTo(0.07, 4);
  });

  it('never returns a loss worse than -100%, however extreme the draw', () => {
    // A lognormal price ratio is strictly positive, so `exp(...) - 1 > -1` always. An
    // additive (non-exponential) formulation would wipe past -100% at -10 sigma.
    expect(gbmPeriodReturn(0.07, 0.15, -10)).toBeGreaterThan(-1);
  });
});

describe('blendedPortfolioReturn', () => {
  it('weights each asset return by its allocation percentage', () => {
    // 0.70 * 0.10 + 0.30 * 0.02
    expect(blendedPortfolioReturn({ stocksPercent: 70, bondsPercent: 30 }, 0.1, 0.02)).toBeCloseTo(
      0.076,
      12,
    );
  });

  it('reads allocation on the 0-100 percent scale, not as a 0-1 fraction', () => {
    // A fraction-scaled implementation would return 0.076 / 100 here.
    expect(blendedPortfolioReturn({ stocksPercent: 50, bondsPercent: 50 }, 0.2, 0)).toBeCloseTo(
      0.1,
      12,
    );
  });

  it('tracks the stock leg alone at a 99/1 allocation', () => {
    // Catches the two legs being swapped: a swap gives 0.99 * -0.20 + 0.01 * 0.30.
    expect(blendedPortfolioReturn({ stocksPercent: 99, bondsPercent: 1 }, 0.3, -0.2)).toBeCloseTo(
      0.295,
      12,
    );
  });
});

describe('extractPercentiles', () => {
  it('takes the 100th, 500th and 900th smallest of 1,000 balances by nearest rank', () => {
    // One year, one path per balance 0..999, so the value at a rank *is* that rank.
    const balancesByPath = Array.from({ length: 1000 }, (_unused, path) => [path]);

    expect(extractPercentiles(balancesByPath)).toEqual({ p10: [99], p50: [499], p90: [899] });
  });

  it('ranks each year independently rather than following one path across years', () => {
    // Three paths that swap rank between year 0 and year 1. Locking onto the path that was
    // median in year 0 (`[2, 1]`) would report 1 for year 1 instead of the year-1 median 50.
    const balancesByPath = [
      [1, 100],
      [2, 1],
      [3, 50],
    ];

    expect(extractPercentiles(balancesByPath)).toEqual({
      p10: [1, 1],
      p50: [2, 50],
      p90: [3, 100],
    });
  });

  it('emits one value per year for every percentile', () => {
    const balancesByPath = [
      [10, 20, 30, 40],
      [11, 21, 31, 41],
    ];

    const { p10, p50, p90 } = extractPercentiles(balancesByPath);

    expect([p10.length, p50.length, p90.length]).toEqual([4, 4, 4]);
  });

  it('handles negative balances without reordering them as failures', () => {
    // A failed path is still a ranked observation; it must sort below the survivors.
    const balancesByPath = [[-500], [0], [500]];

    expect(extractPercentiles(balancesByPath)).toEqual({ p10: [-500], p50: [0], p90: [500] });
  });

  it('sorts numerically, not lexicographically', () => {
    // `Array.prototype.sort` with no comparator orders these as 100, 25, 9.
    const balancesByPath = [[9], [25], [100]];

    expect(extractPercentiles(balancesByPath)).toEqual({ p10: [9], p50: [25], p90: [100] });
  });

  it('does not reorder the caller’s arrays', () => {
    const path = [3, 1, 2];
    const balancesByPath = [path, [9, 9, 9]];

    extractPercentiles(balancesByPath);

    expect(path).toEqual([3, 1, 2]);
  });
});

describe('computeSuccessRate', () => {
  /**
   * Builds a path the way the engine would: ruin is the first year the balance is spent, and
   * from FIN-65 change 4 zero absorbs, so everything after it is zero too. Deriving the
   * marker here rather than hand-setting it keeps these fixtures honest — a path cannot claim
   * to be solvent while showing a broke balance.
   */
  const pathFrom = (balances: number[]) => {
    const ruinPeriod = balances.findIndex((balance) => balance <= 0);
    return {
      balances: balances.map((balance, i) => (ruinPeriod !== -1 && i >= ruinPeriod ? 0 : balance)),
      inflationIndex: balances.map((_unused, i) => 1.025 ** (i + 1)),
      ruinPeriod: ruinPeriod === -1 ? null : ruinPeriod,
    };
  };

  it('reports 100 when every path stays solvent through the horizon', () => {
    expect(computeSuccessRate([pathFrom([100, 200, 300]), pathFrom([50, 25, 10])])).toBe(100);
  });

  it('reports 0 when every path runs dry at some point', () => {
    expect(computeSuccessRate([pathFrom([100, -1, 500]), pathFrom([-0.01, 25, 10])])).toBe(0);
  });

  it('counts a path that only runs dry in its final year as a failure', () => {
    expect(computeSuccessRate([pathFrom([100, 200, -5]), pathFrom([100, 200, 5])])).toBe(50);
  });

  /**
   * Exhausting the portfolio exactly is still exhausting it — Bengen counts a plan that ends
   * at $0 as a failure, not a photo finish. Worth pinning explicitly because the pre-change-4
   * predicate was `balance >= 0`, which called this a success.
   */
  it('counts a path that lands on exactly zero as a failure', () => {
    expect(computeSuccessRate([pathFrom([100, 0]), pathFrom([100, 200])])).toBe(50);
  });

  it('rounds a half-percent to the nearest whole percent', () => {
    const paths = Array.from({ length: 1000 }, (_unused, path) => pathFrom([path < 875 ? 1 : -1]));

    expect(computeSuccessRate(paths)).toBe(88);
  });

  it('rounds down when the fraction is below the half-percent', () => {
    const paths = Array.from({ length: 1000 }, (_unused, path) => pathFrom([path < 874 ? 1 : -1]));

    expect(computeSuccessRate(paths)).toBe(87);
  });
});

describe('validateAllocation', () => {
  it('accepts an allocation that sums to 100', () => {
    expect(() => validateAllocation({ stocksPercent: 70, bondsPercent: 30 })).not.toThrow();
  });

  it('rejects an allocation that does not sum to 100', () => {
    expect(codeThrownBy(() => validateAllocation({ stocksPercent: 70, bondsPercent: 31 }))).toBe(
      'ALLOCATION_SUM_INVALID',
    );
  });

  it('names both weights and their sum in the message it throws', () => {
    expect(() => validateAllocation({ stocksPercent: 70, bondsPercent: 31 })).toThrow(/70/);
    expect(() => validateAllocation({ stocksPercent: 70, bondsPercent: 31 })).toThrow(/31/);
    expect(() => validateAllocation({ stocksPercent: 70, bondsPercent: 31 })).toThrow(/101/);
  });

  it('accepts non-integer weights whose float sum drifts off 100 by less than the epsilon', () => {
    // 33.33 + 66.67 sums to 100.00000000000001 in IEEE-754 — an exact `!== 100` check
    // rejects a perfectly valid split (ERD §6, round-1 review).
    expect(() => validateAllocation({ stocksPercent: 33.33, bondsPercent: 66.67 })).not.toThrow();
  });

  it('accepts a sum inside the 1e-9 epsilon', () => {
    expect(() =>
      validateAllocation({ stocksPercent: 70, bondsPercent: 30 + 5e-10 }),
    ).not.toThrow();
  });

  it('rejects a sum outside the 1e-9 epsilon', () => {
    expect(
      codeThrownBy(() => validateAllocation({ stocksPercent: 70, bondsPercent: 30 + 2e-9 })),
    ).toBe('ALLOCATION_SUM_INVALID');
  });

  it('accepts an all-stock or all-bond (0/100 or 100/0) split (FIN-59)', () => {
    expect(() => validateAllocation({ stocksPercent: 100, bondsPercent: 0 })).not.toThrow();
    expect(() => validateAllocation({ stocksPercent: 0, bondsPercent: 100 })).not.toThrow();
  });

  it('rejects a negative weight even when the pair still sums to 100', () => {
    expect(codeThrownBy(() => validateAllocation({ stocksPercent: 110, bondsPercent: -10 }))).toBe(
      'ALLOCATION_ZERO_WEIGHT',
    );
  });

  it('reports a non-finite weight as a non-finite input, not as a bad sum', () => {
    // `Math.abs(NaN - 100) > 1e-9` is false, so a sum check running first would wave NaN
    // through and only surface it as NaN balances 66 years later.
    expect(codeThrownBy(() => validateAllocation({ stocksPercent: NaN, bondsPercent: 30 }))).toBe(
      'NON_FINITE_INPUT',
    );
    expect(
      codeThrownBy(() => validateAllocation({ stocksPercent: 70, bondsPercent: Infinity })),
    ).toBe('NON_FINITE_INPUT');
  });

  it('reports a missing allocation as a non-finite input', () => {
    expect(codeThrownBy(() => validateAllocation({} as never))).toBe('NON_FINITE_INPUT');
  });
});

describe('drawPortfolioReturn', () => {
  it('blends a stock and bond return drawn with zero correlation', () => {
    // Z_stocks from (0.5, 0) = 1.1774100225154747; with correlation 0, Z_bonds collapses to
    // the independent deviate from (0.75, 0.5) = -1.6651092223153954 (same deviates as the
    // pre-FIN-56 independent-draw behavior). Unlike the pre-FIN-56 version, `mu` is now
    // `ln(1 + 0.07)` (arithmetic-to-log-drift conversion moved inside this function):
    // 0.7 * (exp(ln(1.07) - 0.01125 + 0.15 * Z_s) - 1) + 0.3 * (exp(ln(1.07) - 0.0018 + 0.06 * Z_b) - 1)
    const drawn = drawPortfolioReturn(
      { stocks: 0.07, bonds: 0.07 },
      allocation70_30,
      { stocks: 0.15, bonds: 0.06 },
      0,
      uniforms(0.5, 0, 0.75, 0.5),
    );

    expect(drawn).toBeCloseTo(0.17364240391577182, 12);
  });

  it('consumes four uniforms per period, so stocks and bonds get separate deviates', () => {
    // Reusing one deviate for both assets would leave the last two uniforms unread, and the
    // second period below would then reproduce the first period's return.
    const draw = uniforms(0.5, 0, 0.75, 0.5, 0.5, 0, 0.75, 0.5);
    const volatility = { stocks: 0.15, bonds: 0.06 };
    const returnAssumptions = { stocks: 0.07, bonds: 0.07 };

    const first = drawPortfolioReturn(returnAssumptions, allocation70_30, volatility, 0, draw);
    const second = drawPortfolioReturn(returnAssumptions, allocation70_30, volatility, 0, draw);

    expect(second).toBeCloseTo(first, 12);
  });

  it('with 100% stock allocation, equals the stock draw exactly regardless of bond inputs', () => {
    const draw = uniforms(0.5, 0, 0.75, 0.5);
    const stockOnly = drawPortfolioReturn(
      DEFAULT_RETURN_ASSUMPTIONS,
      { stocksPercent: 100, bondsPercent: 0 },
      DEFAULT_VOLATILITY_ASSUMPTIONS,
      DEFAULT_CORRELATION,
      draw,
    );

    // Same first two uniforms drive the stock deviate; feed them straight to gbmPeriodReturn
    // to get the stock-only return independently of drawPortfolioReturn's own blending.
    const expectedStockReturn = gbmPeriodReturn(
      Math.log(1 + DEFAULT_RETURN_ASSUMPTIONS.stocks),
      DEFAULT_VOLATILITY_ASSUMPTIONS.stocks,
      standardNormal(uniforms(0.5, 0)),
    );

    expect(stockOnly).toBeCloseTo(expectedStockReturn, 12);
  });

  it('with 100% bond allocation, equals the bond draw exactly regardless of stock inputs', () => {
    const draw = uniforms(0.5, 0, 0.75, 0.5);
    const bondOnly = drawPortfolioReturn(
      DEFAULT_RETURN_ASSUMPTIONS,
      { stocksPercent: 0, bondsPercent: 100 },
      DEFAULT_VOLATILITY_ASSUMPTIONS,
      DEFAULT_CORRELATION,
      draw,
    );

    // Reconstruct the same correlated bond deviate independently via correlatedNormals to
    // confirm the 0% stock weight truly zeroes the stock leg out rather than coincidentally
    // matching it.
    const [, bondZ] = correlatedNormals(uniforms(0.5, 0, 0.75, 0.5), DEFAULT_CORRELATION);
    const expectedBondReturn = gbmPeriodReturn(
      Math.log(1 + DEFAULT_RETURN_ASSUMPTIONS.bonds),
      DEFAULT_VOLATILITY_ASSUMPTIONS.bonds,
      bondZ,
    );

    expect(bondOnly).toBeCloseTo(expectedBondReturn, 12);
  });

  it('blends a mixed allocation as the weighted sum of the two legs', () => {
    const allocation = { stocksPercent: 60, bondsPercent: 40 };
    const volatility = DEFAULT_VOLATILITY_ASSUMPTIONS;
    const returns = DEFAULT_RETURN_ASSUMPTIONS;

    const mixed = drawPortfolioReturn(returns, allocation, volatility, DEFAULT_CORRELATION, uniforms(0.5, 0, 0.75, 0.5));

    const [stockZ, bondZ] = correlatedNormals(uniforms(0.5, 0, 0.75, 0.5), DEFAULT_CORRELATION);
    const expected =
      0.6 * gbmPeriodReturn(Math.log(1 + returns.stocks), volatility.stocks, stockZ) +
      0.4 * gbmPeriodReturn(Math.log(1 + returns.bonds), volatility.bonds, bondZ);

    expect(mixed).toBeCloseTo(expected, 12);
  });
});

describe('correlatedNormals', () => {
  it('returns the raw stock deviate unchanged as the first element', () => {
    const draw = uniforms(0.5, 0, 0.75, 0.5);
    const [stockZ] = correlatedNormals(draw, -0.2);

    expect(stockZ).toBeCloseTo(standardNormal(uniforms(0.5, 0)), 12);
  });

  it('reduces to the independent deviate when correlation is 0', () => {
    const draw = uniforms(0.5, 0, 0.75, 0.5);
    const [, bondZ] = correlatedNormals(draw, 0);

    expect(bondZ).toBeCloseTo(standardNormal(uniforms(0.75, 0.5)), 12);
  });

  it('reduces to an exact copy of the stock deviate when correlation is 1', () => {
    const draw = uniforms(0.5, 0, 0.75, 0.5);
    const [stockZ, bondZ] = correlatedNormals(draw, 1);

    expect(bondZ).toBeCloseTo(stockZ, 12);
  });

  it('produces a large sample whose correlation is close to -0.2 (flight-to-quality)', () => {
    const draw = createSeededRandom(20260818);
    const sampleCount = 20_000;
    const stockZs: number[] = [];
    const bondZs: number[] = [];

    for (let i = 0; i < sampleCount; i += 1) {
      const [stockZ, bondZ] = correlatedNormals(draw, DEFAULT_CORRELATION);
      stockZs.push(stockZ);
      bondZs.push(bondZ);
    }

    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const stockMean = mean(stockZs);
    const bondMean = mean(bondZs);
    const covariance =
      mean(stockZs.map((z, i) => (z - stockMean) * (bondZs[i] - bondMean)));
    const stockStd = Math.sqrt(mean(stockZs.map((z) => (z - stockMean) ** 2)));
    const bondStd = Math.sqrt(mean(bondZs.map((z) => (z - bondMean) ** 2)));
    const sampleCorrelation = covariance / (stockStd * bondStd);

    expect(sampleCorrelation).toBeGreaterThan(-0.25);
    expect(sampleCorrelation).toBeLessThan(-0.15);
  });
});

describe('DEFAULT_RETURN_ASSUMPTIONS', () => {
  it('gives stocks a materially higher expected return than bonds', () => {
    expect(DEFAULT_RETURN_ASSUMPTIONS.stocks).toBeGreaterThan(DEFAULT_RETURN_ASSUMPTIONS.bonds);
    // Historical (Ibbotson SBBI/Damodaran 1926-2023) nominal arithmetic mean, large-cap U.S.
    // stocks vs. intermediate-term U.S. government bonds (see the code comment on
    // DEFAULT_RETURN_ASSUMPTIONS for the citation and FIN-64 rationale).
    expect(DEFAULT_RETURN_ASSUMPTIONS.stocks).toBeCloseTo(0.115, 5);
    expect(DEFAULT_RETURN_ASSUMPTIONS.bonds).toBeCloseTo(0.05, 5);
  });

  it('large samples of stock and bond GBM draws have distinctly different means', () => {
    // Regression guard for the original bug: stocks and bonds sharing one blended return.
    const draw = createSeededRandom(90_218);
    const sampleCount = 20_000;
    let stockTotal = 0;
    let bondTotal = 0;

    for (let i = 0; i < sampleCount; i += 1) {
      const [stockZ, bondZ] = correlatedNormals(draw, DEFAULT_CORRELATION);
      stockTotal += gbmPeriodReturn(
        Math.log(1 + DEFAULT_RETURN_ASSUMPTIONS.stocks),
        DEFAULT_VOLATILITY_ASSUMPTIONS.stocks,
        stockZ,
      );
      bondTotal += gbmPeriodReturn(
        Math.log(1 + DEFAULT_RETURN_ASSUMPTIONS.bonds),
        DEFAULT_VOLATILITY_ASSUMPTIONS.bonds,
        bondZ,
      );
    }

    const stockMean = stockTotal / sampleCount;
    const bondMean = bondTotal / sampleCount;

    expect(stockMean).toBeGreaterThan(bondMean);
    expect(stockMean).toBeCloseTo(DEFAULT_RETURN_ASSUMPTIONS.stocks, 1);
    expect(bondMean).toBeCloseTo(DEFAULT_RETURN_ASSUMPTIONS.bonds, 1);
  });
});

describe('createInitialPeriodState', () => {
  it('starts at the current age, year 0, holding the initial balance', () => {
    const state = createInitialPeriodState(assumptions({ currentAge: 42, initialBalance: 250_000 }));

    expect(state.age).toBe(42);
    expect(state.year).toBe(0);
    expect(state.balance).toBe(250_000);
  });

  it('starts with no accumulated rows and no prior withdrawal to inflate', () => {
    const state = createInitialPeriodState(assumptions());

    expect(state.rows).toEqual([]);
    expect(state.priorWithdrawal).toBeNull();
  });
});

describe('runMonteCarloTrial', () => {
  const draw = () => createSeededRandom(2026);

  it('returns one ending balance per projected year, inclusive of both endpoints', () => {
    const plan = assumptions({ currentAge: 35, planningHorizonEndAge: 100 });

    const { balances } = runMonteCarloTrial(plan, [], draw(), trialConfig());

    expect(balances).toHaveLength(66);
  });

  it('returns a single balance when the horizon is the current age', () => {
    const plan = assumptions({ currentAge: 100, retirementAge: 67, planningHorizonEndAge: 100 });

    expect(runMonteCarloTrial(plan, [], draw(), trialConfig()).balances).toHaveLength(1);
  });

  it('threads each period’s ending balance into the next period', () => {
    const seen: number[] = [];
    const record: PipelineStage = (state, input) => {
      seen.push(state.balance);
      return referenceRunPeriod(state, input);
    };

    const { balances } = runMonteCarloTrial(
      assumptions({ planningHorizonEndAge: 39 }),
      [],
      draw(),
      trialConfig({ runPeriodFn: record }),
    );

    // Each period begins where the previous one ended; the first begins at initialBalance.
    expect(seen).toEqual([100_000, ...balances.slice(0, -1)]);
  });

  it('advances age and year one period at a time', () => {
    const seen: Array<[number, number]> = [];
    const record: PipelineStage = (state, input) => {
      seen.push([state.age, state.year]);
      return referenceRunPeriod(state, input);
    };

    runMonteCarloTrial(
      assumptions({ currentAge: 64, planningHorizonEndAge: 67 }),
      [],
      draw(),
      trialConfig({ runPeriodFn: record }),
    );

    expect(seen).toEqual([
      [64, 0],
      [65, 1],
      [66, 2],
      [67, 3],
    ]);
  });

  it('draws a fresh return for every period instead of reusing one rate', () => {
    const returns: number[] = [];
    const record: PipelineStage = (state, input) => {
      returns.push(input.returnForPeriod);
      return referenceRunPeriod(state, input);
    };

    runMonteCarloTrial(assumptions(), [], draw(), trialConfig({ runPeriodFn: record }));

    expect(returns).toHaveLength(66);
    expect(new Set(returns).size).toBe(66);
    // A fixed-rate fold would hand every period `annualReturnRate` instead.
    expect(returns).not.toContain(0.07);
  });

  it('hands the step function the plan, the events and the default strategies', () => {
    const events = [{ type: 'oneTimeExpense' as const, atAge: 40, amount: 25_000, label: 'car' }];
    const plan = assumptions({ planningHorizonEndAge: 36 });
    const seen: Array<{ events: unknown; assumptions: unknown }> = [];
    const record: PipelineStage = (state, input) => {
      seen.push(input);
      return referenceRunPeriod(state, input);
    };

    runMonteCarloTrial(plan, events, draw(), trialConfig({ runPeriodFn: record }));

    expect(seen[0]).toMatchObject({
      events,
      assumptions: plan,
      withdrawalStrategy: withdrawFullShortfall,
      taxCalculator: zeroTax,
    });
  });

  it('produces the same path twice from the same seed', () => {
    const plan = assumptions();

    const first = runMonteCarloTrial(plan, [], createSeededRandom(7), trialConfig());
    const second = runMonteCarloTrial(plan, [], createSeededRandom(7), trialConfig());

    expect(second).toEqual(first);
  });

  it('produces a different path from a different seed', () => {
    const plan = assumptions();

    const first = runMonteCarloTrial(plan, [], createSeededRandom(7), trialConfig());
    const second = runMonteCarloTrial(plan, [], createSeededRandom(8), trialConfig());

    expect(second).not.toEqual(first);
  });

  /**
   * Sequence-of-returns risk is the whole point of Story 2: a path with poor early returns
   * must retire on its own smaller balance and therefore draw a smaller first withdrawal.
   * Seeding every path from a shared deterministic baseline would hide exactly that.
   */
  it('seeds the first retirement withdrawal from that path’s own balance at retirement', () => {
    const plan = assumptions({ currentAge: 60, retirementAge: 65, planningHorizonEndAge: 70 });
    const finalStates: PeriodState[] = [];
    const capture: PipelineStage = (state, input) => {
      const next = referenceRunPeriod(state, input);
      finalStates[input.assumptions.currentAge] = next;
      return next;
    };

    const firstWithdrawals = [11, 12].map((seed) => {
      runMonteCarloTrial(plan, [], createSeededRandom(seed), trialConfig({ runPeriodFn: capture }));
      const retirementRow = finalStates[60].rows.find((row) => row.age === 65);

      return retirementRow;
    });

    for (const row of firstWithdrawals) {
      expect(row?.annualWithdrawal).toBeCloseTo(row!.beginningBalance * 0.04, 9);
    }
    expect(firstWithdrawals[0]?.annualWithdrawal).not.toBeCloseTo(
      firstWithdrawals[1]!.annualWithdrawal,
      6,
    );
  });

  it('generates a distinct return sequence for each of 1,000 paths from one seeded source', () => {
    const plan = assumptions();
    const draw = createSeededRandom(1234);

    const paths = Array.from({ length: 1000 }, () =>
      runMonteCarloTrial(plan, [], draw, trialConfig()).balances.join(),
    );

    expect(new Set(paths).size).toBe(1000);
  });
});

describe('runMonteCarloTrials', () => {
  const options = (extra: Record<string, unknown> = {}) => ({
    seed: 2026,
    runPeriodFn: referenceRunPeriod,
    ...extra,
  });

  it('returns the MonteCarloResult shape and nothing else', () => {
    const result = runMonteCarloTrials(assumptions(), allocation70_30, undefined, [], options());

    expect(Object.keys(result).sort()).toEqual(['meta', 'percentiles', 'successRate']);
    expect(Object.keys(result.percentiles).sort()).toEqual(['nominal', 'real']);
    expect(Object.keys(result.percentiles.nominal).sort()).toEqual(['p10', 'p50', 'p90']);
    expect(Object.keys(result.percentiles.real).sort()).toEqual(['p10', 'p50', 'p90']);
    expect(Object.keys(result.meta).sort()).toEqual([
      'allocation',
      'bondVolatility',
      'simulationCount',
      'stockVolatility',
    ]);
  });

  it('echoes the allocation on the same 0-100 scale it was given', () => {
    const result = runMonteCarloTrials(
      assumptions(),
      { stocksPercent: 70, bondsPercent: 30 },
      undefined,
      [],
      options({ simulationCount: 20 }),
    );

    // Not { stocks: 0.7, bonds: 0.3 } — ERD §4's round-1 review pins the 0-100 scale.
    expect(result.meta.allocation).toEqual({ stocks: 70, bonds: 30 });
  });

  it('runs 5,000 paths and reports the historical volatility defaults', () => {
    const result = runMonteCarloTrials(assumptions(), allocation70_30, undefined, [], options());

    expect(result.meta.simulationCount).toBe(5000);
    expect(result.meta.stockVolatility).toBe(0.195);
    expect(result.meta.bondVolatility).toBe(0.077);
  });

  it('reports overridden volatility assumptions instead of the defaults', () => {
    const result = runMonteCarloTrials(
      assumptions(),
      allocation70_30,
      { stocks: 0.22, bonds: 0.09 },
      [],
      options({ simulationCount: 20 }),
    );

    expect(result.meta.stockVolatility).toBe(0.22);
    expect(result.meta.bondVolatility).toBe(0.09);
  });

  it('applies an overridden volatility to the draws, not just to the reported meta', () => {
    const spread = (stocks: number) => {
      const { percentiles } = runMonteCarloTrials(
        assumptions(),
        allocation70_30,
        { stocks, bonds: 0.06 },
        [],
        options({ simulationCount: 200, returnModel: 'gbm' }),
      );

      return percentiles.nominal.p90[65] - percentiles.nominal.p10[65];
    };

    expect(spread(0.3)).toBeGreaterThan(spread(0.05));
  });

  it('emits one percentile value per projected year', () => {
    const result = runMonteCarloTrials(
      assumptions({ currentAge: 35, planningHorizonEndAge: 100 }),
      allocation70_30,
      undefined,
      [],
      options({ simulationCount: 50 }),
    );

    for (const fan of [result.percentiles.real, result.percentiles.nominal]) {
      expect(fan.p10).toHaveLength(66);
      expect(fan.p50).toHaveLength(66);
      expect(fan.p90).toHaveLength(66);
    }
  });

  it('returns identical results for the same seed', () => {
    const run = () =>
      runMonteCarloTrials(assumptions(), allocation70_30, undefined, [], options({ seed: 99 }));

    expect(run()).toEqual(run());
  });

  it('returns different results for different seeds', () => {
    const run = (seed: number) =>
      runMonteCarloTrials(assumptions(), allocation70_30, undefined, [], options({ seed }));

    expect(run(99)).not.toEqual(run(100));
  });

  /**
   * Catches a fallback to `Math.random()` — or to any source the `seed` option does not
   * reach — which would still pass the two tests above only if it were also seeded.
   */
  it('varies run to run when no seed is given', () => {
    const run = () =>
      runMonteCarloTrials(
        assumptions(),
        allocation70_30,
        undefined,
        [],
        { runPeriodFn: referenceRunPeriod, simulationCount: 50 },
      );

    expect(run()).not.toEqual(run());
  });

  /**
   * The one property R3 requires at every single year. A fixed-path-identity fan (following
   * whichever path was 10th percentile in some reference year) violates it as soon as paths
   * cross rank, which they do constantly over a 66-year horizon.
   */
  it('keeps p10 <= p50 <= p90 at every year across a large batch of runs', () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const { percentiles } = runMonteCarloTrials(
        assumptions(),
        allocation70_30,
        undefined,
        [],
        options({ seed, simulationCount: 200 }),
      );

      // Both fans, because they are ranked independently: real is not a rescaling of
      // nominal, so nominal satisfying the ordering says nothing about real.
      for (const fan of [percentiles.real, percentiles.nominal]) {
        for (let year = 0; year < fan.p50.length; year += 1) {
          expect(fan.p10[year]).toBeLessThanOrEqual(fan.p50[year]);
          expect(fan.p50[year]).toBeLessThanOrEqual(fan.p90[year]);
        }
      }
    }
  });

  it('reports 100% success when no path can run out of money', () => {
    // Never retires within the horizon, so there is nothing to withdraw and a lognormal
    // return can never take the balance below zero.
    const result = runMonteCarloTrials(
      assumptions({ currentAge: 35, retirementAge: 101, planningHorizonEndAge: 100 }),
      allocation70_30,
      undefined,
      [],
      options(),
    );

    expect(result.successRate).toBe(100);
  });

  it('reports 0% success when every path is drained before the horizon', () => {
    // Already retired, withdrawing the entire balance in year 0 and an inflation-adjusted
    // repeat of that figure every year after: no return sequence survives year 1.
    const result = runMonteCarloTrials(
      assumptions({
        currentAge: 70,
        retirementAge: 65,
        planningHorizonEndAge: 100,
        withdrawalRateInRetirement: 1,
      }),
      allocation70_30,
      undefined,
      [],
      options(),
    );

    expect(result.successRate).toBe(0);
  });

  it('reports a whole-number success rate between 0 and 100 for a mixed plan', () => {
    const result = runMonteCarloTrials(
      assumptions({
        currentAge: 60,
        retirementAge: 62,
        initialBalance: 700_000,
        withdrawalRateInRetirement: 0.07,
      }),
      allocation70_30,
      undefined,
      [],
      options(),
    );

    expect(Number.isInteger(result.successRate)).toBe(true);
    expect(result.successRate).toBeGreaterThan(0);
    expect(result.successRate).toBeLessThan(100);
  });

  it('rejects an invalid allocation before running any path', () => {
    expect(
      codeThrownBy(() =>
        runMonteCarloTrials(
          assumptions(),
          { stocksPercent: 70, bondsPercent: 20 },
          undefined,
          [],
          options(),
        ),
      ),
    ).toBe('ALLOCATION_SUM_INVALID');
  });

  it('rejects a non-finite volatility assumption', () => {
    expect(
      codeThrownBy(() =>
        runMonteCarloTrials(
          assumptions(),
          allocation70_30,
          { stocks: NaN, bonds: 0.06 },
          [],
          options(),
        ),
      ),
    ).toBe('NON_FINITE_INPUT');
    expect(
      codeThrownBy(() =>
        runMonteCarloTrials(
          assumptions(),
          allocation70_30,
          { stocks: 0.15, bonds: Infinity },
          [],
          options(),
        ),
      ),
    ).toBe('NON_FINITE_INPUT');
  });

  /**
   * Proves the default step function is the engine's own pipeline rather than math this
   * module reimplements — which the tests above cannot show, since they all inject a step.
   *
   * Swaps the stage array's *contents* (the same technique `pipeline.test.ts` uses) so it
   * keeps working once FIN-16 fills the real stages in, and restores them afterwards.
   */
  it('folds the engine’s pipeline stages by default', () => {
    const mutableStages = pipelineStages as PipelineStage[];
    const realStages = [...mutableStages];
    let calls = 0;
    const probe: PipelineStage = (state, input) => {
      calls += 1;
      return { ...state, balance: state.balance * (1 + input.returnForPeriod) };
    };

    mutableStages.splice(0, mutableStages.length, probe);

    try {
      const result = runMonteCarloTrials(
        assumptions({ currentAge: 95, planningHorizonEndAge: 100 }),
        allocation70_30,
        undefined,
        [],
        { seed: 3, simulationCount: 10 },
      );

      expect(calls).toBe(60);
      // The probe grows the balance every period, so no path can be flat at its start value.
      expect(result.percentiles.nominal.p50[5]).not.toBe(100_000);
    } finally {
      mutableStages.splice(0, mutableStages.length, ...realStages);
    }
  });
});

describe('degenerate inputs', () => {
  it('rejects a plan whose horizon ends before it starts', () => {
    // Left ungated, `periodCount` goes <= 0, every path is `[]`, and `[].every(...)` is
    // `true` — so a nonsense plan reports a reassuring 100% success rate to the UI.
    const code = codeThrownBy(() =>
      runMonteCarloTrials(
        assumptions({ currentAge: 70, planningHorizonEndAge: 65 }),
        allocation70_30,
      ),
    );

    expect(code).toBe('CURRENT_AGE_EXCEEDS_HORIZON');
  });

  it.each([['currentAge'], ['planningHorizonEndAge']])(
    'rejects a non-finite %s before it reaches the loop bound',
    (field) => {
      // The same false-100% failure mode as a reversed horizon, through a different door:
      // a NaN age makes `periodCount` NaN, the fold runs zero periods, and an empty batch
      // reads as a plan that never went negative.
      const code = codeThrownBy(() =>
        runMonteCarloTrials(assumptions({ [field]: Number.NaN }), allocation70_30),
      );

      expect(code).toBe('NON_FINITE_INPUT');
    },
  );

  it('accepts a plan whose horizon is a single year', () => {
    const result = runMonteCarloTrials(
      assumptions({ currentAge: 65, planningHorizonEndAge: 65 }),
      allocation70_30,
      undefined,
      [],
      { seed: 5, simulationCount: 20, runPeriodFn: referenceRunPeriod },
    );

    expect(result.percentiles.nominal.p50).toHaveLength(1);
  });

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['fractional', 2.7],
  ])('rejects a %s simulation count', (_label, simulationCount) => {
    // Zero divides by zero into a NaN success rate; a fractional count silently runs
    // `Math.floor` paths while reporting the fraction back in `meta`.
    const code = codeThrownBy(() =>
      runMonteCarloTrials(assumptions(), allocation70_30, undefined, [], { simulationCount }),
    );

    expect(code).toBe('SIMULATION_COUNT_INVALID');
  });

  it('rejects a non-finite simulation count as a non-finite input', () => {
    const code = codeThrownBy(() =>
      runMonteCarloTrials(assumptions(), allocation70_30, undefined, [], {
        simulationCount: Number.NaN,
      }),
    );

    expect(code).toBe('NON_FINITE_INPUT');
  });

  it('rejects a non-finite seed rather than silently seeding from zero', () => {
    // `seed >>> 0` turns NaN into 0, so a caller who thinks they passed a random seed
    // would get a fixed one and never know.
    const code = codeThrownBy(() =>
      runMonteCarloTrials(assumptions(), allocation70_30, undefined, [], {
        seed: Number.NaN,
      }),
    );

    expect(code).toBe('NON_FINITE_INPUT');
  });

  it('reports a zero success rate for an empty batch rather than NaN', () => {
    expect(computeSuccessRate([])).toBe(0);
  });
});

/**
 * Accuracy spot-check: FIN-17's acceptance criterion asks that results agree with an
 * established external retirement calculator within 2% across five scenarios.
 *
 * Reference figures: the closed forms below are the standard future-value arithmetic such
 * calculators are built on — a lump sum plus a growing annuity, and a lump sum drawn down
 * by an inflation-indexed withdrawal. They are written as direct summations rather than
 * period-by-period recursions, so they are genuinely independent of the fold under test
 * and a bug there cannot hide by being mirrored in the expectation. What they are *not*
 * is a figure copied from a named third-party tool: the "contributions earn no return in
 * the year they are made" convention (ERD §5) is a modelling choice not every calculator
 * shares, so pinning someone else's number would test their convention, not ours.
 * Cross-checking one scenario against a named external tool is worth doing at FIN-19,
 * once the real pipeline stages make the engine's numbers final.
 *
 * Which statistic to compare, and why it is *not* p50: for GBM,
 * `E[exp((μ − σ²/2)Δt + σ√Δt·Z)] = exp(μ)`, so the expected per-period return is
 * `exp(μ) − 1` regardless of volatility or allocation, while the *median* per-period
 * return is the lower `exp(μ − σ²/2) − 1` (exact per asset; the blend of two independent
 * lognormals has no such closed form, but lands between the two legs). The mean is the
 * right comparison because expectation propagates through the recursion exactly:
 * contributions are deterministic and every withdrawal is linear in the path's own
 * balance, so `E[balance_t]` equals the deterministic projection at rate `exp(μ) − 1`.
 * Measured p50-versus-closed-form gaps across these scenarios run from −4.4% to −18.5%, so
 * a p50 comparison would blow the 2% band by construction rather than because of a bug.
 *
 * Seeds are pinned so the suite is deterministic, but they are not load-bearing: every
 * scenario was re-run against three independent seed sets during development, and a
 * 25-seed sweep during review measured the sampling spread directly (see the path counts
 * below). This is not a case of tuning until one seed passed.
 */
describe('accuracy against deterministic reference figures', () => {
  /**
   * Path counts per scenario, chosen from a measured 25-seed sweep of the relative error
   * (FIN-17 review). Accumulation-only scenarios have a sampling standard deviation of
   * 0.25-0.48% at 8,000 paths — 4-8σ of headroom inside the 2% band. The two scenarios
   * that include a drawdown are noisier (0.80% and 1.02%), because each retirement
   * withdrawal is proportional to a balance that has already accumulated variance, and at
   * 8,000 paths they sat only ~2σ from the tolerance — about a 1-in-20 chance of a red
   * run on an unlucky seed. Since the standard error falls as 1/√N, 32,000 paths restores
   * them to ~4-5σ.
   */
  const ACCUMULATION_PATHS = 8_000;
  const DRAWDOWN_PATHS = 32_000;
  const ACCURACY_TOLERANCE = 0.02;

  /**
   * The arithmetic mean per-period return the simulation should produce. `runMonteCarloTrial`
   * converts `annualReturnRate` to log-drift via `ln(1 + rate)` before feeding it to
   * `gbmPeriodReturn`, so `E[R]` comes back out to exactly `annualReturnRate` (FIN-17 mean
   * convention, resolved 2026-08-18).
   */
  const meanPeriodReturn = (plan: PlanAssumptions): number => plan.annualReturnRate;

  const periodCount = (plan: PlanAssumptions): number =>
    plan.planningHorizonEndAge - plan.currentAge + 1;

  /**
   * Future value of a lump sum plus contributions that grow with raises. Contributions do
   * not earn a return in the year they are made (ERD §5), hence the `n - 1 - k` exponent.
   */
  const accumulationFutureValue = (
    plan: PlanAssumptions,
    years: number,
    startingBalance: number,
  ): number => {
    const rate = meanPeriodReturn(plan);
    let futureValue = startingBalance * (1 + rate) ** years;
    for (let year = 0; year < years; year += 1) {
      const contribution =
        plan.currentAnnualIncome *
        (1 + plan.annualRaiseRate) ** year *
        plan.annualContributionRate;
      futureValue += contribution * (1 + rate) ** (years - 1 - year);
    }
    return futureValue;
  };

  /**
   * Future value of a portfolio in drawdown: the first withdrawal is
   * `startingBalance × withdrawalRateInRetirement` and each later one is indexed to
   * inflation.
   *
   * FIN-65 change 2 moved the withdrawal to the START of the year, so the money taken in year
   * `k` forgoes growth for that year as well as every year after it — `n - k` periods, where
   * the old end-of-year model gave it `n - 1 - k`. That single exponent is the whole
   * difference between the two published conventions, and it is what makes ours the more
   * conservative of the two.
   */
  const drawdownFutureValue = (
    plan: PlanAssumptions,
    years: number,
    startingBalance: number,
  ): number => {
    const rate = meanPeriodReturn(plan);
    const firstWithdrawal = startingBalance * plan.withdrawalRateInRetirement;
    let futureValue = startingBalance * (1 + rate) ** years;
    for (let year = 0; year < years; year += 1) {
      const withdrawal = firstWithdrawal * (1 + plan.inflationRate) ** year;
      futureValue -= withdrawal * (1 + rate) ** (years - year);
    }
    return futureValue;
  };

  /**
   * Accumulate to retirement, then draw down. The two phases compose exactly under
   * expectation: contributions are deterministic and every withdrawal is linear in the
   * path's own balance, so `E[balance]` propagates through both recursions unchanged.
   */
  const accumulateThenDrawDownFutureValue = (plan: PlanAssumptions): number => {
    const accumulationYears = plan.retirementAge - plan.currentAge;
    const balanceAtRetirement = accumulationFutureValue(
      plan,
      accumulationYears,
      plan.initialBalance,
    );
    return drawdownFutureValue(
      plan,
      plan.planningHorizonEndAge - plan.retirementAge + 1,
      balanceAtRetirement,
    );
  };

  const meanFinalBalance = (plan: PlanAssumptions, seed: number, paths: number): number => {
    const draw = createSeededRandom(seed);
    let total = 0;
    for (let path = 0; path < paths; path += 1) {
      const { balances } = runMonteCarloTrial(plan, [], draw, trialConfig());
      total += balances[balances.length - 1];
    }
    return total / paths;
  };

  const expectWithinTolerance = (actual: number, expected: number): void => {
    expect(Math.abs(actual / expected - 1)).toBeLessThan(ACCURACY_TOLERANCE);
  };

  it('matches a 25-year accumulation projection', () => {
    // Age 40 to 64, $100k saved, $80k salary, 15% savings rate, 3% raises, no retirement
    // inside the horizon.
    const plan = assumptions({
      currentAge: 40,
      retirementAge: 65,
      planningHorizonEndAge: 64,
    });

    expectWithinTolerance(
      meanFinalBalance(plan, 90_210, ACCUMULATION_PATHS),
      accumulationFutureValue(plan, periodCount(plan), plan.initialBalance),
    );
  });

  it('matches a 10-year late-career accumulation projection', () => {
    // Age 55 to 64 with a large balance already accumulated — the run-up to retirement.
    const plan = assumptions({
      currentAge: 55,
      retirementAge: 65,
      planningHorizonEndAge: 64,
      initialBalance: 600_000,
      currentAnnualIncome: 120_000,
      annualContributionRate: 0.2,
    });

    expectWithinTolerance(
      meanFinalBalance(plan, 90_211, ACCUMULATION_PATHS),
      accumulationFutureValue(plan, periodCount(plan), plan.initialBalance),
    );
  });

  it('matches a 30-year projection that starts from nothing saved', () => {
    // PRD edge case: a $0 starting balance, so the whole result comes from contributions.
    const plan = assumptions({
      currentAge: 25,
      retirementAge: 65,
      planningHorizonEndAge: 54,
      initialBalance: 0,
      currentAnnualIncome: 55_000,
      annualContributionRate: 0.1,
    });

    expectWithinTolerance(
      meanFinalBalance(plan, 90_213, ACCUMULATION_PATHS),
      accumulationFutureValue(plan, periodCount(plan), plan.initialBalance),
    );
  });

  it('matches a 20-year retirement drawdown projection', () => {
    // Already retired at 70 with $1.2M, drawing 4% indexed to 2.5% inflation.
    const plan = assumptions({
      currentAge: 70,
      retirementAge: 65,
      planningHorizonEndAge: 89,
      initialBalance: 1_200_000,
    });

    expectWithinTolerance(
      meanFinalBalance(plan, 90_212, DRAWDOWN_PATHS),
      drawdownFutureValue(plan, periodCount(plan), plan.initialBalance),
    );
  });

  it('matches a projection that accumulates to retirement and then draws down', () => {
    // The full-lifecycle case: 15 years of saving from 50, then 15 years of retirement.
    // Each path's first withdrawal is 4% of *its own* balance at 65, so this is the
    // scenario where sequence-of-returns risk actually bites.
    const plan = assumptions({
      currentAge: 50,
      retirementAge: 65,
      planningHorizonEndAge: 79,
      initialBalance: 400_000,
    });

    expectWithinTolerance(
      meanFinalBalance(plan, 90_214, DRAWDOWN_PATHS),
      accumulateThenDrawDownFutureValue(plan),
    );
  });
});

describe('validated success-rate regression (FIN-56)', () => {
  /**
   * Target range derivation: an independent, from-scratch reimplementation of standard
   * lognormal/GBM Monte Carlo (Box-Muller normals, `bond_z = rho*stock_z + sqrt(1-rho^2)*iid_z`
   * correlation, per-period portfolio return `w_stock*stockReturn + w_bond*bondReturn`,
   * compounded year over year) was written as a throwaway Node script (not committed — see the
   * FIN-56 PR description for the full script) against this exact scenario: age 35 -> 100
   * (matching this file's `assumptions()` defaults and horizon), retire at 67, $100k starting
   * balance, $80k income, 15% contribution rate, 3% raises, 2.5% inflation, 4% withdrawal rate
   * in retirement, 70/30 stock/bond, stocks 7%/15%, bonds 4.5%/6%, correlation -0.2.
   *
   * Run at 20,000 paths across 5 different seeds, that reconstruction produced success rates
   * of 72.35%, 71.80%, 72.20%, 72.16%, 72.33% — mean 72.16%, essentially no seed-to-seed
   * spread. Running the app's own `runMonteCarloTrials` against the identical scenario (seed
   * 1, 20,000 paths) independently produced 72% — matching the from-scratch reconstruction to
   * within its own rounding, which is the whole point of an independent check: two unrelated
   * implementations of the same model agree.
   *
   * This is a real, materially lower number than a naive "should be near 100%" expectation —
   * a 66-year horizon with a 34-year, inflation-indexed 4%-of-balance-at-retirement drawdown
   * is a genuinely hard scenario once volatility drag and sequence-of-returns risk are modeled
   * honestly, and it is deliberately NOT the pre-fix 77%/100% figures from the ticket's bug
   * report (this file must not reuse those as the target per FIN-56's stated test impact).
   *
   * The assertion band (60-85%) is wide relative to the ~72% center to absorb Monte Carlo's
   * own sampling noise at a real (not inflated) path count, while still being tight enough to
   * catch a regression that reintroduces the original bug — e.g. reverting to a shared 7%/7%
   * return would push this well above 85% (closer to the old ~77%, and further still without
   * the ballast bonds provide against a bad sequence), and reverting correlation to 0 shifts it
   * measurably too.
   */
  it('lands in the validated success-rate range for the age 35-100 accumulate-then-drawdown scenario', () => {
    const plan = assumptions({ currentAge: 35, retirementAge: 67, planningHorizonEndAge: 100 });

    // Pinned to the exact 7%/15% stocks, 4.5%/6% bonds the independent reimplementation above
    // was run against (FIN-56) — not the engine's current defaults, which FIN-64 has since
    // recalibrated. This test's whole point is agreement with that specific external check.
    const result = runMonteCarloTrials(
      plan,
      allocation70_30,
      { stocks: 0.15, bonds: 0.06 },
      [],
      {
        seed: 1,
        simulationCount: 20_000,
        returnAssumptions: { stocks: 0.07, bonds: 0.045 },
        runPeriodFn: referenceRunPeriod,
        returnModel: 'gbm',
      },
    );

    expect(result.successRate).toBeGreaterThanOrEqual(60);
    expect(result.successRate).toBeLessThanOrEqual(85);
  }, 15000);
});

/**
 * FIN-55: regression test formalizing an external formula-validation pass against the
 * closed-form analytic lognormal-GBM median, `median = P0 * exp((ln(1+r) - sigma^2/2) * T)`.
 *
 * Isolated pure GBM growth — no contributions, no withdrawals, a 100% stock allocation — so
 * the only thing under test is `gbmPeriodReturn`/`drawPortfolioReturn`'s per-period draw and
 * `extractPercentiles`' nearest-rank P50, with none of the projection's other stages able to
 * mask a regression there.
 *
 * The ticket's originating validation pass measured the engine's P50 ($327,060) against this
 * same closed-form median ($309,001) — a ~5.8% gap, attributed to nearest-rank sampling noise
 * at 5,000 paths rather than a bug — against the PRE-FIN-56 stock/bond modeling (shared
 * mean return, zero correlation). FIN-56 has since split stock/bond expected returns and
 * introduced a fixed -0.2 correlation; re-verified empirically before writing this test
 * (see the FIN-55 PR description) that a 100%-stock isolation is unaffected, because
 * `correlatedNormals` degenerates the bond leg into an independent draw that a 100/0
 * allocation weights at zero regardless — the stock leg's own math, and its expected value,
 * are untouched by FIN-56. Measured post-FIN-56 P50/median ratios at 5,000 paths across two
 * seeds (42, 7) came back at 1.00006 and 1.0104 — within roughly 1%, comfortably inside the
 * ticket's ~10% band, so the tolerance below is left as specified rather than loosened.
 */
describe('FIN-55: pure-GBM isolation against the analytic lognormal median', () => {
  /** Applies only GBM growth to the balance — no contributions, no withdrawals, no tax. */
  const growthOnlyStep: PipelineStage = (state, input) => {
    const beginningBalance = state.balance;
    const endingBalance = beginningBalance * (1 + input.returnForPeriod);

    return {
      ...state,
      beginningBalance,
      investmentReturn: endingBalance - beginningBalance,
      balance: endingBalance,
      rows: [
        ...state.rows,
        {
          age: state.age,
          year: state.year,
          beginningBalance,
          annualContribution: 0,
          investmentReturn: endingBalance - beginningBalance,
          annualWithdrawal: 0,
          endingBalance,
        },
      ],
    };
  };

  const isolationPlan: PlanAssumptions = assumptions({
    currentAge: 40,
    // Retirement is pushed past the horizon so `withdrawalRateInRetirement` never engages —
    // belt-and-braces alongside `growthOnlyStep`, which ignores retirement entirely.
    retirementAge: 200,
    initialBalance: 100_000,
    currentAnnualIncome: 0,
    annualContributionRate: 0,
    annualRaiseRate: 0,
    annualReturnRate: 0.07,
    inflationRate: 0,
    withdrawalRateInRetirement: 0,
    planningHorizonEndAge: 59, // 20-year horizon: age 40 -> 59.
  });

  const stocksOnly = { stocksPercent: 100, bondsPercent: 0 };
  const P0 = 100_000;
  // Must track DEFAULT_RETURN_ASSUMPTIONS.stocks (FIN-64 recalibrated it away from 0.07) since
  // simulateFinalBalances below feeds the simulation DEFAULT_RETURN_ASSUMPTIONS directly.
  const meanReturn = DEFAULT_RETURN_ASSUMPTIONS.stocks;
  const stockVolatility = DEFAULT_VOLATILITY_ASSUMPTIONS.stocks;
  const years = 20;

  /** `median = P0 * exp((ln(1+r) - sigma^2/2) * T)` — the closed-form lognormal-GBM median. */
  const analyticMedian =
    P0 * Math.exp((Math.log(1 + meanReturn) - (stockVolatility * stockVolatility) / 2) * years);

  /** The deterministic Story 1 projection's arithmetic-mean ending balance for the same inputs. */
  const deterministicArithmeticMean = P0 * (1 + meanReturn) ** years;

  const simulateFinalBalances = (seed: number, simulationCount: number): number[] => {
    const draw = createSeededRandom(seed);
    const config: TrialConfig = {
      allocation: stocksOnly,
      volatility: DEFAULT_VOLATILITY_ASSUMPTIONS,
      returnAssumptions: DEFAULT_RETURN_ASSUMPTIONS,
      correlation: DEFAULT_CORRELATION,
      runPeriodFn: growthOnlyStep,
      returnModel: 'gbm',
    };

    return Array.from({ length: simulationCount }, () => {
      const { balances } = runMonteCarloTrial(isolationPlan, [], draw, config);
      return balances[balances.length - 1];
    });
  };

  const percentile50 = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };

  it('produces a P50 within ~10% of the analytic lognormal median', () => {
    const finalBalances = simulateFinalBalances(7, 5_000);
    const p50 = percentile50(finalBalances);

    expect(Math.abs(p50 / analyticMedian - 1)).toBeLessThan(0.1);
  });

  /**
   * Regression guard against re-introducing double-counted volatility drag (see
   * `gbmPeriodReturn`'s doc comment in `monteCarlo.ts`, "RESOLVED" — the resolved design
   * decision this pins). A GBM median is always strictly below the arithmetic-mean/deterministic
   * projection for the same inputs whenever volatility is nonzero; if a future change fed the
   * simulation an already geometric-mean-adjusted rate, the drag would apply twice and P50
   * would fall well short of this bound by a much wider margin than sampling noise explains,
   * while a change that removed the drag entirely would push P50 up toward (or past) the
   * deterministic figure.
   */
  it('keeps P50 below the deterministic arithmetic-mean projection for the same inputs', () => {
    const finalBalances = simulateFinalBalances(7, 5_000);
    const p50 = percentile50(finalBalances);

    expect(p50).toBeLessThan(deterministicArithmeticMean);
  });
});

describe('performance', () => {
  it('runs 5,000 paths over a full horizon inside the 3s budget', () => {
    // FIN-17 originally pinned this budget to 500ms for the pure engine work at 1,000
    // paths. FIN-54 raised the default path count from 1,000 to 5,000; measured cost at
    // 5,000 paths is ~70-190ms on developer hardware (was 32-38ms at 1,000) — a healthy
    // margin there — but CI's shared runners are far slower and noisier: an actual CI run
    // measured ~1.57s for this same assertion, over 3x the old 500ms ceiling even though
    // nothing algorithmically regressed. Bumping to a 3s budget keeps real headroom over
    // that measured CI figure (roughly 2x) while still failing loudly if someone
    // reintroduces per-period allocation or sorting inside the path loop, which costs
    // orders of magnitude, not tens of percent. This engine call runs off the UI thread
    // inside the stress-test Web Worker (src/workers/monteCarloWorkerEntry.ts), so this
    // budget guards CI signal / worker-thread cost, not main-thread responsiveness.
    const plan = assumptions({ currentAge: 35, planningHorizonEndAge: 100 });

    const startedAt = performance.now();
    const result = runMonteCarloTrials(plan, allocation70_30, undefined, [], {
      seed: 7,
      runPeriodFn: referenceRunPeriod,
    });
    const elapsedMs = performance.now() - startedAt;

    expect(result.meta.simulationCount).toBe(5_000);
    expect(result.percentiles.nominal.p50).toHaveLength(66);
    expect(elapsedMs).toBeLessThan(3_000);
  });
});

/**
 * FIN-65 change 1: inflation is sampled jointly with returns, from the same historical year.
 *
 * Before this change `computeWithdrawals` inflated retirement spending at a flat 2.5% while
 * `applyGrowth` was fed NOMINAL historical returns that already carried whatever inflation
 * that year actually had — half a nominal model and half a real one. The bias is not
 * symmetric noise: it inverts the cohort ranking, flattering exactly the high-inflation
 * cohorts (1966-1969) the safe-withdrawal-rate literature is built on.
 *
 * These tests deliberately do NOT run the block bootstrap. They walk history in chronological
 * order, so the expectation is a property of the model and of our data tables rather than of
 * one seed's draw order.
 *
 * ON THE EXPECTED VALUES: FIN-65 quotes $3.22M -> $117.5K (and ProjectionLab's $150.8K) for
 * the 1966 cohort. Those were measured on ProjectionLab's return and CPI series through a
 * local research harness that is not part of this repo. The figures below are derived
 * independently from OUR OWN tables — Damodaran S&P 500 total returns
 * (`HISTORICAL_ANNUAL_RETURNS`) and Minneapolis Fed CPI-U (`HISTORICAL_ANNUAL_INFLATION`) —
 * a different series, so they neither do nor should match the ticket exactly. The ticket's
 * numbers serve only as an order-of-magnitude cross-check: hundreds of thousands, not
 * millions.
 */
describe('FIN-65: joint historical inflation, chronological cohorts', () => {
  /** $1M, 4% ($40k) initial withdrawal, 30 years, 100% stocks, already retired, no taxes. */
  const cohortPlan = assumptions({
    currentAge: 65,
    retirementAge: 65,
    planningHorizonEndAge: 94,
    initialBalance: 1_000_000,
    currentAnnualIncome: 0,
    annualContributionRate: 0,
    annualRaiseRate: 0,
    withdrawalRateInRetirement: 0.04,
    inflationRate: 0.025,
  });

  /** Cumulative CPI-U over the cohort's own years, used to restate terminals in start-year dollars. */
  const cumulativeInflation = (startYear: number, years: number): number => {
    let factor = 1;
    for (let offset = 0; offset < years; offset += 1) factor *= 1 + yearCpi(startYear + offset);
    return factor;
  };

  /**
   * Folds the REAL `runPeriod` over a fixed chronological run of history, 100% stocks.
   * `useHistoricalInflation: false` reproduces the pre-FIN-65 behaviour by simply omitting
   * `inflationForPeriod` — the same code path the deterministic Plan tab takes.
   *
   * The CPI handed to period `offset` is the PRIOR year's (FIN-65 change 3), which is what
   * `runMonteCarloTrial` does on an unbroken chronological run. The first period gets
   * `undefined`: it has no prior year, and its withdrawal is `rate x beginningBalance`, which
   * never reads an inflation rate.
   */
  const runCohort = (
    startYear: number,
    years: number,
    useHistoricalInflation: boolean,
  ): { rows: readonly ProjectionRow[]; terminal: number; terminalInStartYearDollars: number } => {
    let state = createInitialPeriodState(cohortPlan);

    for (let offset = 0; offset < years; offset += 1) {
      const year = startYear + offset;
      state = runPeriod(state, {
        events: [],
        assumptions: cohortPlan,
        returnForPeriod: yearStockReturn(year),
        inflationForPeriod:
          useHistoricalInflation && offset > 0 ? yearCpi(year - 1) : undefined,
        withdrawalStrategy: withdrawFullShortfall,
        taxCalculator: zeroTax,
      });
      state = { ...state, age: state.age + 1, year: state.year + 1 };
    }

    return {
      rows: state.rows,
      terminal: state.balance,
      terminalInStartYearDollars: state.balance / cumulativeInflation(startYear, years),
    };
  };

  describe('the 1966 cohort — the canonical worst case in the SWR literature', () => {
    it('spends the first three years exactly as the published recurrence says', () => {
      const { rows } = runCohort(1966, 30, true);

      // The recurrence is `ending = (beginning - w) * (1 + r)` — FIN-65 change 2's
      // start-of-year withdrawal, per Bengen (1994) and Trinity — with each withdrawal
      // indexed by the PRIOR year's realised CPI (change 3).

      // Year 1 (1966): the withdrawal is 4% of the START-of-year balance, no CPI involved.
      //   w = 1_000_000 * 0.04 = 40_000
      //   ending = (1_000_000 - 40_000) * (1 - 0.0997) = 960_000 * 0.9003 = 864_288
      expect(rows[0].annualWithdrawal).toBeCloseTo(40_000, 6);
      expect(rows[0].endingBalance).toBeCloseTo(864_288, 6);

      // Year 2 (1967): 1967 return +23.80%, indexed by 1966's CPI-U +3.17%.
      //   w = 40_000 * 1.0317 = 41_268
      //   ending = (864_288 - 41_268) * 1.238 = 823_020 * 1.238 = 1_018_898.76
      expect(rows[1].annualWithdrawal).toBeCloseTo(41_268, 6);
      expect(rows[1].endingBalance).toBeCloseTo(1_018_898.76, 4);

      // Year 3 (1968): 1968 return +10.81%, indexed by 1967's CPI-U +2.77%.
      //   w = 41_268 * 1.0277 = 42_411.1236
      //   ending = (1_018_898.76 - 42_411.1236) * 1.1081 = 976_487.6364 * 1.1081
      //          = 1_082_045.94989484
      expect(rows[2].annualWithdrawal).toBeCloseTo(42_411.1236, 4);
      expect(rows[2].endingBalance).toBeCloseTo(1_082_045.94989, 3);
    });

    it('inflates spending at realised CPI, not 2.5%, so the 1970s cost what they cost', () => {
      const withHistorical = runCohort(1966, 30, true);
      const withFixed = runCohort(1966, 30, false);

      // The ninth year, 1974. Fixed: 40_000 * 1.025^8 = 48_736.12. Prior-year realised CPI-U,
      // so the eight indexing years are 1966-1973 (change 3 shifted this window back one from
      // the 1967-1974 change 1 used):
      // 40_000 * 1.0317 * 1.0277 * 1.0419 * 1.0546 * 1.0572 * 1.0438 * 1.0321 * 1.0622
      // = 56_376.24 — 16% more spending, on the same portfolio, in the same years.
      expect(withFixed.rows[8].annualWithdrawal).toBeCloseTo(40_000 * 1.025 ** 8, 6);
      expect(withFixed.rows[8].annualWithdrawal).toBeCloseTo(48_736.12, 2);
      expect(withHistorical.rows[8].annualWithdrawal).toBeCloseTo(
        40_000 * [1966, 1967, 1968, 1969, 1970, 1971, 1972, 1973].reduce((acc, y) => acc * (1 + yearCpi(y)), 1),
        6,
      );
      expect(withHistorical.rows[8].annualWithdrawal).toBeCloseTo(56_376.24, 2);
    });

    /**
     * The headline regression. Terminal wealth after 30 years, restated in 1966 dollars by
     * dividing out the cohort's own realised cumulative CPI-U (4.83774x over 1966-1995).
     *
     * Derived by folding the documented recurrence
     *   ending_t = (beginning_t - w_t) * (1 + r_t),  w_0 = 1_000_000 * 0.04,
     *   w_t = w_(t-1) * (1 + cpi_(t-1))
     * over 1966-1995 of our own two tables — not by recording what the engine printed.
     *
     * Cross-check against the ticket (measured on ProjectionLab's different series):
     * as-shipped $3.22M -> $117.5K real, and Bengen's own model on that series lands at
     * -$157.8K. Ours moves $1.170M -> -$86.6K: same direction, and now on the same side of
     * zero as Bengen, which is the point — the 1966 retiree taking a 4% initial withdrawal
     * indexed to *realised* CPI does not comfortably survive 30 years. A result still in the
     * millions would mean joint sampling never reached the withdrawal stage.
     *
     * Change 3 (prior-year indexing) moved this from -$208,720.19 real / -$1,009,733.57
     * nominal to the figures below: one year less compounding on every withdrawal, worth
     * ~$590K nominal on a $1M portfolio over these 30 years. The nominal figure now equals
     * `runBengen`'s to the cent — see the year-by-year oracle below, which is the test that
     * actually pins the convention.
     */
    it('falls from ~$1.17M to ~-$87K in 1966 dollars once CPI is real', () => {
      const withFixed = runCohort(1966, 30, false);
      const withHistorical = runCohort(1966, 30, true);

      expect(cumulativeInflation(1966, 30)).toBeCloseTo(4.83774, 5);

      expect(withFixed.terminalInStartYearDollars).toBeCloseTo(1_169_969.88, 2);
      expect(withHistorical.terminalInStartYearDollars).toBeCloseTo(-86_579.92, 2);
      expect(withHistorical.terminal).toBeCloseTo(-418_850.97, 2);

      // The order-of-magnitude fence the ticket asks for: hundreds of thousands either side of
      // zero, never millions.
      expect(Math.abs(withHistorical.terminalInStartYearDollars)).toBeLessThan(1_000_000);
    });
  });

  /**
   * The control. 1994-2023 realised cumulative CPI-U is 2.10880x, and a flat 2.5% over 30
   * years bakes in 1.025^30 = 2.09757x. The two coincide, so this is the cohort the old model
   * already got right, and joint sampling must leave it essentially where it was. If this one
   * moves materially, the wiring is wrong rather than the fix working.
   */
  it('barely moves the 1994 cohort, whose realised CPI matches the 2.5% assumption', () => {
    const withFixed = runCohort(1994, 30, false);
    const withHistorical = runCohort(1994, 30, true);

    expect(cumulativeInflation(1994, 30)).toBeCloseTo(2.1088, 4);
    expect(1.025 ** 30).toBeCloseTo(2.09757, 5);

    // Change 3 moved the historical figure from $4,313,484.97 to $4,306,063.02 — still a
    // fraction of a percent from the fixed-rate run, which is the whole point of this control.
    expect(withFixed.terminalInStartYearDollars).toBeCloseTo(4_283_578.76, 1);
    expect(withHistorical.terminalInStartYearDollars).toBeCloseTo(4_306_063.02, 1);

    const relativeMove =
      Math.abs(withHistorical.terminalInStartYearDollars - withFixed.terminalInStartYearDollars) /
      withFixed.terminalInStartYearDollars;
    expect(relativeMove).toBeLessThan(0.01);
  });
});

/**
 * FIN-65 change 1 + change 3, the wiring: `runMonteCarloTrial` must hand each period the
 * CPI-U of the historical year drawn in the PREVIOUS period.
 *
 * Change 1 keyed the lookup off the year drawn for the *current* period. Change 3 lags it,
 * because Bengen (1994) and Trinity index a year's withdrawal to the prior year's realised
 * CPI: a retiree setting their 1967 budget in January 1967 does not yet know 1967's
 * inflation. See `runMonteCarloTrial`'s comment for why the lag follows the sampled path
 * rather than the calendar.
 *
 * Either way the CPI comes from the same block bootstrap the returns came from — no second
 * sampler and no second RNG draw.
 */
describe('FIN-65: runMonteCarloTrial passes the prior drawn year inflation', () => {
  /** `draw` pinned to 0 always selects block start index 0 — 1928-1932, repeatedly. */
  const alwaysFirstBlock = (): number => 0;

  const capturingStep =
    (seen: Array<{ ret: number; inflation: number | undefined }>): PipelineStage =>
    (state, input) => {
      seen.push({ ret: input.returnForPeriod, inflation: input.inflationForPeriod });
      return referenceRunPeriod(state, input);
    };

  it('lags the CPI one period along the sampled path, across the block seam', () => {
    const seen: Array<{ ret: number; inflation: number | undefined }> = [];
    const plan = assumptions({ currentAge: 65, retirementAge: 65, planningHorizonEndAge: 74 });

    runMonteCarloTrial(plan, [], alwaysFirstBlock, {
      allocation: { stocksPercent: 100, bondsPercent: 0 },
      volatility: DEFAULT_VOLATILITY_ASSUMPTIONS,
      returnAssumptions: DEFAULT_RETURN_ASSUMPTIONS,
      correlation: DEFAULT_CORRELATION,
      runPeriodFn: capturingStep(seen),
    });

    // Ten periods = the 1928-1932 block drawn twice.
    const expectedYears = [1928, 1929, 1930, 1931, 1932, 1928, 1929, 1930, 1931, 1932];
    expect(seen).toHaveLength(expectedYears.length);
    expect(seen.map((period) => period.ret)).toEqual(expectedYears.map((year) => yearStockReturn(year)));

    // The CPI series is the drawn-year series shifted one period later. Period 0 gets
    // `undefined` — it has no previous period, and its withdrawal is `rate x balance` with no
    // indexing at all, so nothing can consume it.
    //
    // Period 5 is the block seam and the reason this reading was chosen over "the calendar
    // year before the drawn year". Period 5 draws 1928 again; the calendar reading would want
    // 1927, which exists in NEITHER of our tables (both start at 1928). The path reading asks
    // instead what this simulated retiree lived through last period — 1932 — which is always
    // a year the path actually sampled.
    expect(seen.map((period) => period.inflation)).toEqual([
      undefined,
      ...[1928, 1929, 1930, 1931, 1932, 1928, 1929, 1930, 1931].map((year) => yearCpi(year)),
    ]);
  });

  it('leaves inflationForPeriod undefined on the GBM branch, which has no historical year', () => {
    const seen: Array<{ ret: number; inflation: number | undefined }> = [];
    const plan = assumptions({ currentAge: 65, retirementAge: 65, planningHorizonEndAge: 69 });

    runMonteCarloTrial(plan, [], createSeededRandom(11), {
      allocation: allocation70_30,
      volatility: DEFAULT_VOLATILITY_ASSUMPTIONS,
      returnAssumptions: DEFAULT_RETURN_ASSUMPTIONS,
      correlation: DEFAULT_CORRELATION,
      returnModel: 'gbm',
      runPeriodFn: capturingStep(seen),
    });

    expect(seen).toHaveLength(5);
    for (const period of seen) {
      expect(period.inflation).toBeUndefined();
    }
  });
});

/**
 * FIN-65 change 3: the strongest oracle on this branch.
 *
 * WHAT THIS TEST IS FOR. Every other FIN-65 test checks a terminal value, an ordering or a
 * wiring detail. A terminal value is a single number, and a single number can be matched by a
 * model that is wrong in compensating ways — the off-by-one this change fixes survived a
 * green suite precisely because nothing compared our path to a published one year by year.
 * This test pins our engine to Bengen (1994) at EVERY year's withdrawal and EVERY year's
 * ending balance, across five cohorts. If someone later re-indexes the withdrawal to the
 * current year, moves the withdrawal back to the end of the year, or lets the plan's flat
 * `inflationRate` leak into the historical path, this fails and names the year it broke.
 *
 * INDEPENDENCE. `bengenPath` below is written from the published method, not from our engine:
 * withdraw `rate * initialBalance` at the START of year 1, invest the remainder for the year,
 * and index each subsequent withdrawal by the PRIOR year's realised CPI — the retiree setting
 * a 1967 budget in January 1967 does not yet know 1967's inflation. It shares no code with
 * `pipeline.ts` and calls nothing from it. (The research harness that first proved this
 * hypothesis is gitignored and absent from CI, so it is deliberately reimplemented here
 * rather than imported.)
 *
 * NO RNG. Our side runs the real `runMonteCarloTrial` — the production path, including the
 * lag logic — with `blockLengthYears: 1` and a scripted `draw` that walks consecutive
 * calendar years. At block length 1 each period's draw selects one historical year outright,
 * so the path is an unbroken chronological run and the two candidate readings of "prior year"
 * coincide. That is the case Bengen defines, and it is the case this test pins.
 */
describe('FIN-65: matches Bengen year by year, not just at the terminal', () => {
  const BENGEN_COHORTS = [1966, 1929, 1937, 1973, 1994];
  const INITIAL_BALANCE = 1_000_000;
  const WITHDRAWAL_RATE = 0.04;
  const HORIZON_YEARS = 30;

  interface BengenYear {
    withdrawal: number;
    endingBalance: number;
  }

  /**
   * Bengen (1994) / Trinity, implemented from the published formula. NOT our engine.
   *
   *   w_0     = initialBalance * rate
   *   end_t   = (begin_t - w_t) * (1 + r_t)
   *   w_(t+1) = w_t * (1 + cpi_t)      <- the prior-year indexing this change is about
   *
   * Left unclamped on purpose, so it stays a transcription of the published arithmetic and
   * nothing else. Bengen's own output for a failed cohort is the YEAR the portfolio was
   * exhausted, not the negative number this fold keeps producing afterwards — which is
   * exactly what FIN-65 change 4 fixes on our side. The comparison below therefore runs
   * against this reference up to the year of exhaustion, and asserts our own absorbing-zero
   * behaviour after it.
   */
  const bengenPath = (
    returns: readonly number[],
    inflation: readonly number[],
    years: number,
  ): BengenYear[] => {
    const path: BengenYear[] = [];
    let balance = INITIAL_BALANCE;
    let withdrawal = INITIAL_BALANCE * WITHDRAWAL_RATE;

    for (let t = 0; t < years; t += 1) {
      balance = (balance - withdrawal) * (1 + returns[t]);
      path.push({ withdrawal, endingBalance: balance });
      withdrawal *= 1 + inflation[t];
    }

    return path;
  };

  /**
   * The year each cohort is exhausted, folded out of `bengenPath` over our own tables — the
   * first year its ending balance reaches zero, 1-based, or `null` for a cohort that lasts
   * the full 30. 1966 and 1929 are the safe-withdrawal literature's canonical worst cases,
   * and a 4% initial withdrawal indexed to realised inflation survives neither.
   */
  const RUIN_YEAR: Record<number, number | null> = {
    1966: 29,
    1929: 22,
    1937: null,
    1973: null,
    1994: null,
  };

  /**
   * Our production trial, walked down a chosen chronological run of history.
   *
   * `inflationRate` is set to a deliberately absurd 10% — nowhere near the 2.5% the rest of
   * the suite uses, and nowhere near any of these cohorts' realised CPI. The historical path
   * must never consult it, so if any period falls back to `assumptions.inflationRate` the
   * withdrawal series diverges immediately and loudly. This is also how the first period's
   * `undefined` is verified inert rather than assumed: period 0 is handed no CPI at all, and
   * a 10% fallback would still leave year 1 matching (the opening withdrawal is
   * `rate x balance`) while blowing up year 2.
   */
  const oursChronological = (
    startYear: number,
    years: number,
  ): { captured: Array<{ withdrawal: number; endingBalance: number }>; path: TrialPath } => {
    const plan = assumptions({
      currentAge: 65,
      retirementAge: 65,
      planningHorizonEndAge: 65 + years - 1,
      initialBalance: INITIAL_BALANCE,
      currentAnnualIncome: 0,
      annualContributionRate: 0,
      annualRaiseRate: 0,
      withdrawalRateInRetirement: WITHDRAWAL_RATE,
      inflationRate: 0.1,
    });

    const startIndex = HISTORICAL_ANNUAL_RETURNS.findIndex((row) => row.year === startYear);
    expect(startIndex).toBeGreaterThanOrEqual(0);

    // `createHistoricalReturnGenerator` picks a block start with
    // `Math.floor(draw() * (maxStart + 1))`; at blockLength 1, maxStart + 1 is the table
    // length, so `(index + 0.5) / length` selects `index` outright, one year per period.
    let period = 0;
    const scriptedDraw = (): number =>
      (startIndex + period++ + 0.5) / HISTORICAL_ANNUAL_RETURNS.length;

    const captured: Array<{ withdrawal: number; endingBalance: number }> = [];
    const capturingStep: PipelineStage = (state, input) => {
      const next = runPeriod(state, input);
      captured.push({ withdrawal: next.annualWithdrawal, endingBalance: next.balance });
      return next;
    };

    const path = runMonteCarloTrial(plan, [], scriptedDraw, {
      allocation: { stocksPercent: 100, bondsPercent: 0 },
      volatility: DEFAULT_VOLATILITY_ASSUMPTIONS,
      returnAssumptions: DEFAULT_RETURN_ASSUMPTIONS,
      correlation: DEFAULT_CORRELATION,
      returnModel: 'historical',
      blockLengthYears: 1,
      runPeriodFn: capturingStep,
    });

    return { captured, path };
  };

  it.each(BENGEN_COHORTS)(
    'reproduces Bengen every year of the %i cohort, withdrawal and balance',
    (startYear) => {
      const years = Array.from({ length: HORIZON_YEARS }, (_unused, offset) => startYear + offset);
      const expected = bengenPath(
        years.map((year) => yearStockReturn(year)),
        years.map((year) => yearCpi(year)),
        HORIZON_YEARS,
      );
      const { captured: actual, path } = oursChronological(startYear, HORIZON_YEARS);

      expect(actual).toHaveLength(HORIZON_YEARS);

      // Up to and including the year of exhaustion the two must agree exactly; after it the
      // published fold keeps compounding a negative balance and we do not (change 4).
      const ruinYear = RUIN_YEAR[startYear];
      const comparable = ruinYear ?? HORIZON_YEARS;

      for (let t = 0; t < comparable; t += 1) {
        // Tight tolerance: these are two float folds of the same arithmetic in the same
        // order, so they agree far beyond 6 decimal places. Anything looser would let a real
        // convention change hide.
        expect(
          actual[t].withdrawal,
          `${startYear} cohort, year ${t + 1} (${years[t]}) withdrawal`,
        ).toBeCloseTo(expected[t].withdrawal, 6);
        expect(
          actual[t].endingBalance,
          `${startYear} cohort, year ${t + 1} (${years[t]}) ending balance`,
        ).toBeCloseTo(expected[t].endingBalance, 6);
      }

      if (ruinYear === null) {
        expect(path.ruinPeriod, `${startYear} cohort should survive 30 years`).toBeNull();
        return;
      }

      // `RUIN_YEAR` is 1-based; `ruinPeriod` indexes from 0.
      expect(path.ruinPeriod, `${startYear} cohort year of exhaustion`).toBe(ruinYear - 1);
      expect(expected[ruinYear - 1].endingBalance).toBeLessThanOrEqual(0);
      path.balances.slice(ruinYear - 1).forEach((balance, offset) => {
        expect(balance, `${startYear} cohort, year ${ruinYear + offset} after exhaustion`).toBe(0);
      });
    },
  );

  /**
   * The terminal figures the year-by-year comparison implies, spelled out so a reader can see
   * what these cohorts actually do and cross-check them by hand.
   *
   * Derived by folding `bengenPath` over our own tables (Damodaran S&P 500 total returns and
   * Minneapolis Fed CPI-U), NOT by recording engine output. 1966 and 1929 — the two cohorts
   * the safe-withdrawal-rate literature treats as the worst cases — run out of money; a 4%
   * initial withdrawal indexed to realised inflation does not survive either.
   */
  it('lands where the published method says, cohort by cohort', () => {
    const terminals = new Map(
      BENGEN_COHORTS.map((startYear) => [
        startYear,
        oursChronological(startYear, HORIZON_YEARS).path.balances[HORIZON_YEARS - 1],
      ]),
    );

    // The three cohorts that survive carry the published fold's terminal balance through
    // unchanged — the clamp is inert on a path that never runs dry, which is half of what
    // makes it safe to add.
    expect(terminals.get(1937)).toBeCloseTo(2_416_346.19, 2);
    expect(terminals.get(1973)).toBeCloseTo(1_293_045.76, 2);
    expect(terminals.get(1994)).toBeCloseTo(9_080_639.91, 2);

    // The two that fail end at zero, not at the -$418K and -$1.33M the unclamped fold
    // reports. Those figures were never a retiree's experience: they are what you get by
    // continuing to withdraw from an account that has nothing in it, and letting a good
    // return year deepen the hole. Bengen's answer for these cohorts is a year, not a number.
    expect(terminals.get(1966)).toBe(0);
    expect(terminals.get(1929)).toBe(0);
  });
});


/**
 * FIN-65 changes 3 and 4: a trial hands back the CPI path it actually lived through, and a
 * ruined path stops at zero instead of folding on into ever-larger negatives.
 *
 * Every expectation here is derived from the model — the CPI table, the definition of a
 * cumulative price index, and the absorbing-state rule — never from what the engine prints.
 */
describe('trial path: inflation index and ruin', () => {
  /**
   * Steers the shipped trial down a chronological run of history with no RNG. At
   * `blockLengthYears: 1` the block picker is one `draw()` per period, so successive
   * bucket midpoints march the sampler through the table in order. This drives the
   * production sampler, not a replica of it.
   */
  const scriptedDraw = (startYear: number) => {
    const start = HISTORICAL_ANNUAL_RETURNS.findIndex((entry) => entry.year === startYear);
    if (start === -1) throw new Error(`no return data for ${startYear}`);
    let call = 0;
    return () => (start + call++ + 0.5) / HISTORICAL_ANNUAL_RETURNS.length;
  };

  const historicalConfig = (): TrialConfig =>
    trialConfig({ returnModel: 'historical', blockLengthYears: 1 });

  it('reports a cumulative CPI index built from the years it actually drew', () => {
    const startYear = 1966;
    const plan = assumptions({ currentAge: 60, retirementAge: 60, planningHorizonEndAge: 64 });

    const path = runMonteCarloTrial(plan, [], scriptedDraw(startYear), historicalConfig());

    // A price index is the running product of each period's realised CPI — the year that
    // period drew, NOT the lagged year that indexes its withdrawal. Both series come from
    // the same draws and must not be conflated.
    let level = 1;
    const expected = path.inflationIndex.map((_, offset) => {
      level *= 1 + yearCpi(startYear + offset);
      return level;
    });

    expect(path.inflationIndex.length).toBeGreaterThan(0);
    path.inflationIndex.forEach((actual, i) => {
      expect(actual).toBeCloseTo(expected[i], 10);
    });
  });

  it("falls back to the plan's fixed inflation rate on the GBM branch, which draws no year", () => {
    const plan = assumptions({ currentAge: 60, planningHorizonEndAge: 63, inflationRate: 0.025 });

    const path = runMonteCarloTrial(plan, [], createSeededRandom(7), trialConfig());

    expect(path.inflationIndex.length).toBeGreaterThan(0);
    path.inflationIndex.forEach((level, i) => {
      expect(level).toBeCloseTo(1.025 ** (i + 1), 10);
    });
  });

  /**
   * The defect this guards: a bankrupt path used to keep "withdrawing" from a negative
   * balance, so a good return year made it *more* negative. Zero has to absorb.
   */
  it('clamps a ruined path at zero and holds it there for every later period', () => {
    const plan = assumptions({
      currentAge: 60,
      retirementAge: 60,
      planningHorizonEndAge: 75,
      initialBalance: 10_000,
      withdrawalRateInRetirement: 0.9,
    });

    const path = runMonteCarloTrial(plan, [], createSeededRandom(3), trialConfig());

    expect(path.ruinPeriod).not.toBeNull();
    expect(Math.min(...path.balances)).toBeGreaterThanOrEqual(0);
    path.balances.slice(path.ruinPeriod as number).forEach((balance) => {
      expect(balance).toBe(0);
    });
  });

  it('leaves ruinPeriod null and never clamps a path that stays solvent', () => {
    const plan = assumptions({
      currentAge: 60,
      retirementAge: 90,
      planningHorizonEndAge: 70,
      initialBalance: 1_000_000,
    });

    const path = runMonteCarloTrial(plan, [], createSeededRandom(3), trialConfig());

    expect(path.ruinPeriod).toBeNull();
    expect(Math.min(...path.balances)).toBeGreaterThan(0);
  });

  /**
   * Clamping must not change how many draws a trial consumes. `runMonteCarloTrials` shares
   * one RNG stream across every path, so a ruined trial that returned early would shift
   * every path after it — silently changing results that have nothing to do with ruin.
   */
  it('consumes the same number of draws whether or not the path ruins', () => {
    const horizon = { currentAge: 60, retirementAge: 60, planningHorizonEndAge: 75 };
    const count = (initialBalance: number, withdrawalRateInRetirement: number) => {
      let draws = 0;
      const source = createSeededRandom(11);
      const counting = () => {
        draws += 1;
        return source();
      };
      runMonteCarloTrial(
        assumptions({ ...horizon, initialBalance, withdrawalRateInRetirement }),
        [],
        counting,
        trialConfig(),
      );
      return draws;
    };

    expect(count(10_000, 0.9)).toBe(count(10_000_000, 0.01));
  });
});

describe('computeSuccessRate with clamped paths', () => {
  const pathOf = (balances: number[], ruinPeriod: number | null) => ({
    balances,
    inflationIndex: balances.map((_, i) => 1.025 ** (i + 1)),
    ruinPeriod,
  });

  /**
   * The trap in FIN-65 change 4. Success used to be inferred from the *sign* of the balance.
   * Clamping ruined paths to zero makes every balance non-negative, so a sign check would
   * now report 100% success on a portfolio that went bankrupt. Ruin has to be a recorded
   * fact, not something re-derived from the numbers that clamping erased.
   */
  it('counts a clamped-to-zero path as a failure even though no balance is negative', () => {
    const paths = [pathOf([100, 0, 0], 1), pathOf([100, 120, 140], null)];

    expect(paths.every((path) => path.balances.every((balance) => balance >= 0))).toBe(true);
    expect(computeSuccessRate(paths)).toBe(50);
  });

  it('reports 100% when no path ever ruined', () => {
    expect(computeSuccessRate([pathOf([1, 2], null), pathOf([3, 4], null)])).toBe(100);
  });

  it('reports 0% when every path ruined', () => {
    expect(computeSuccessRate([pathOf([1, 0], 1), pathOf([2, 0], 1)])).toBe(0);
  });
});

/**
 * FIN-65 change 3's correctness trap. Each path lives through its own CPI sequence, so a
 * percentile *line* has no single inflation series it could be deflated by after the fact —
 * and paths re-rank under deflation, so real p50 is not deflated nominal p50.
 */
describe('real-dollar percentiles', () => {
  it('deflates each path by its own index before ranking, so paths may re-rank', () => {
    // One period, two paths. Nominally A leads; after each is deflated by the inflation IT
    // lived through, B leads. Ranking nominally and deflating the line afterwards inverts it.
    const pathA = { balances: [300], inflationIndex: [3], ruinPeriod: null }; // real 100
    const pathB = { balances: [200], inflationIndex: [1], ruinPeriod: null }; // real 200

    const real = extractPercentiles([pathA, pathB].map(toTodaysDollars));

    expect(real.p90).toEqual([200]);
    expect(real.p10).toEqual([100]);

    // The wrong construction, for contrast: rank nominally, then deflate the line. It picks
    // A as the top path and reports a different number entirely.
    const nominal = extractPercentiles([pathA.balances, pathB.balances]);
    expect(nominal.p90).toEqual([300]);
  });

  it('exposes both views from one run, with real below nominal under positive inflation', () => {
    const plan = assumptions({ currentAge: 60, planningHorizonEndAge: 70 });

    const result = runMonteCarloTrials(plan, allocation70_30, undefined, [], {
      seed: 42,
      simulationCount: 50,
      runPeriodFn: referenceRunPeriod,
      returnModel: 'gbm',
    });

    expect(result.percentiles.real.p50).toHaveLength(result.percentiles.nominal.p50.length);
    result.percentiles.real.p50.forEach((real, i) => {
      expect(real).toBeLessThan(result.percentiles.nominal.p50[i]);
    });
  });
});
