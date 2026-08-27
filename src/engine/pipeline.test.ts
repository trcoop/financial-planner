import { describe, expect, it } from 'vitest';

import {
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
import { withdrawFullShortfall, zeroTax } from './strategies';
import type {
  PeriodState,
  PipelineStage,
  ProjectionRow,
  RunPeriodInput,
  TaxCalculator,
  TaxContext,
  WithdrawalStrategy,
} from './types';

const periodState = (overrides: Partial<PeriodState> = {}): PeriodState => ({
  age: 35,
  year: 0,
  balance: 100_000,
  priorIncome: 0,
  priorWithdrawal: null,
  rows: [],
  // Deliberately different from `balance` so that a stage which sets `beginningBalance`
  // from `balance` when it should not — anything other than `snapshotBeginningBalance` — is
  // caught by the identity assertions below rather than passing unnoticed.
  beginningBalance: 42_000,
  investmentReturn: 0,
  annualContribution: 0,
  annualWithdrawal: 0,
  ...overrides,
});

const runPeriodInput = (overrides: Partial<RunPeriodInput> = {}): RunPeriodInput => ({
  events: [],
  assumptions: {
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
  },
  returnForPeriod: 0.07,
  withdrawalStrategy: withdrawFullShortfall,
  taxCalculator: zeroTax,
  ...overrides,
});

describe('pipelineStages', () => {
  it('runs the stages in the order the architecture fixes', () => {
    // Reordered once, deliberately, at FIN-65 change 2: `computeWithdrawals` moved ahead of
    // `applyGrowth` so a retirement year resolves as `(beginning - withdrawal) * (1 + r)`,
    // and the beginning-balance snapshot moved into its own leading stage to make that
    // possible. `computeIncome` stayed put, after growth — contributions still earn no return
    // in the year they are made.
    expect(pipelineStages).toEqual([
      snapshotBeginningBalance,
      applyLifeEvents,
      computeWithdrawals,
      applyGrowth,
      computeIncome,
      applyTax,
      recordPeriod,
    ]);
  });
});

describe('stage purity', () => {
  const stages: ReadonlyArray<[string, PipelineStage]> = [
    ['applyGrowth', applyGrowth],
    ['applyLifeEvents', applyLifeEvents],
    ['computeIncome', computeIncome],
    ['computeWithdrawals', computeWithdrawals],
    ['snapshotBeginningBalance', snapshotBeginningBalance],
    ['applyTax', applyTax],
    ['recordPeriod', recordPeriod],
  ];

  it.each(stages)('%s does not mutate the state it is given', (_name, stage) => {
    const state = periodState();

    stage(state, runPeriodInput());

    expect(state).toEqual(periodState());
  });

  it.each(stages)('%s does not mutate the rows array it is given', (_name, stage) => {
    const rows: ProjectionRow[] = [];
    const state = periodState({ rows });

    stage(state, runPeriodInput());

    expect(rows).toEqual([]);
  });
});

describe('applyGrowth', () => {
  it('grows the balance by the period return', () => {
    const result = applyGrowth(periodState({ balance: 100_000 }), runPeriodInput({ returnForPeriod: 0.07 }));

    expect(result.balance).toBe(107_000);
  });

  it('leaves the beginning-balance snapshot alone — that is snapshotBeginningBalance now', () => {
    // FIN-65 change 2. `applyGrowth` used to take the snapshot itself, which only worked
    // while it ran first. It now runs *after* `computeWithdrawals`, where `state.balance` is
    // already net of the withdrawal, so taking the snapshot here would report a beginning
    // balance that is short by exactly one year's spending.
    const result = applyGrowth(
      periodState({ balance: 100_000, beginningBalance: 42_000 }),
      runPeriodInput({ returnForPeriod: 0.07 }),
    );

    expect(result.beginningBalance).toBe(42_000);
  });

  it('records the investment return in dollars', () => {
    const result = applyGrowth(periodState({ balance: 100_000 }), runPeriodInput({ returnForPeriod: 0.07 }));

    // `toBeCloseTo`, not `toBe`: 100_000 * 0.07 is 7000.000000000001 under IEEE-754, and
    // ERD §5 mandates raw floats with no intermediate rounding anywhere in the engine.
    expect(result.investmentReturn).toBeCloseTo(7_000, 6);
  });

  it('uses the period return, not the assumptions return rate, so Monte Carlo can vary it', () => {
    // `assumptions.annualReturnRate` stays at 0.07 here — only `returnForPeriod` changes.
    const result = applyGrowth(periodState({ balance: 200_000 }), runPeriodInput({ returnForPeriod: -0.2 }));

    expect(result.balance).toBe(160_000);
    expect(result.investmentReturn).toBe(-40_000);
  });

  it('drives a negative balance further negative rather than flooring it', () => {
    const result = applyGrowth(periodState({ balance: -50_000 }), runPeriodInput({ returnForPeriod: 0.07 }));

    expect(result.investmentReturn).toBeCloseTo(-3_500, 6);
    expect(result.balance).toBeCloseTo(-53_500, 6);
  });
});

describe('snapshotBeginningBalance', () => {
  it('records the balance the period opened with', () => {
    const result = snapshotBeginningBalance(
      periodState({ balance: 100_000, beginningBalance: 42_000 }),
      runPeriodInput(),
    );

    expect(result.beginningBalance).toBe(100_000);
  });

  it('changes nothing else — it is a snapshot, not arithmetic', () => {
    const state = periodState({ balance: 100_000 });

    const result = snapshotBeginningBalance(state, runPeriodInput());

    expect(result).toEqual({ ...state, beginningBalance: 100_000 });
  });

  it('snapshots a negative balance as-is rather than flooring it', () => {
    const result = snapshotBeginningBalance(periodState({ balance: -50_000 }), runPeriodInput());

    expect(result.beginningBalance).toBe(-50_000);
  });
});

describe('computeIncome', () => {
  it('uses currentAnnualIncome as-is in year 0, before any raise applies', () => {
    const result = computeIncome(periodState({ age: 35, year: 0, priorIncome: 0 }), runPeriodInput());

    expect(result.priorIncome).toBe(80_000);
  });

  it('ignores any prior income in year 0, keying off the year rather than a zero balance', () => {
    // Guards a mutant that survived otherwise: `priorIncome * (1 + raise) || currentIncome`
    // is indistinguishable from the spec whenever year 0's priorIncome happens to be 0.
    const result = computeIncome(periodState({ age: 35, year: 0, priorIncome: 55_000 }), runPeriodInput());

    expect(result.priorIncome).toBe(80_000);
  });

  it('applies the raise rate to the prior year income from year 1 on', () => {
    const result = computeIncome(periodState({ age: 36, year: 1, priorIncome: 80_000 }), runPeriodInput());

    expect(result.priorIncome).toBeCloseTo(82_400, 6);
  });

  it('compounds the raise off the prior year income, not off currentAnnualIncome', () => {
    // Year 2 from an already-raised 82_400 must reach 84_872, not 80_000 * 1.03 again.
    const result = computeIncome(periodState({ age: 37, year: 2, priorIncome: 82_400 }), runPeriodInput());

    expect(result.priorIncome).toBeCloseTo(84_872, 6);
  });

  it('contributes the configured share of this year income', () => {
    const result = computeIncome(periodState({ age: 35, year: 0 }), runPeriodInput());

    expect(result.annualContribution).toBeCloseTo(12_000, 6);
  });

  it('adds the contribution to the balance', () => {
    const result = computeIncome(periodState({ age: 35, year: 0, balance: 107_000 }), runPeriodInput());

    expect(result.balance).toBeCloseTo(119_000, 6);
  });

  it('contributes nothing and earns nothing once at retirement age', () => {
    const result = computeIncome(periodState({ age: 67, year: 32, balance: 107_000 }), runPeriodInput());

    expect(result.annualContribution).toBe(0);
    expect(result.priorIncome).toBe(0);
    expect(result.balance).toBe(107_000);
  });

  it('zeroes income in retirement rather than freezing the last working salary', () => {
    // The retirement cases above all start from a `priorIncome` of 0, where "set it to 0" and
    // "leave it alone" are indistinguishable — a mutation survivor. The difference is invisible
    // in Story 1's rows, but a frozen salary would feed phantom earned income to a real
    // `TaxCalculator` every retirement year from Story 4 on.
    const result = computeIncome(periodState({ age: 67, year: 32, priorIncome: 103_000 }), runPeriodInput());

    expect(result.priorIncome).toBe(0);
  });

  it('treats an already-retired starting age as retirement at year 0', () => {
    const result = computeIncome(
      periodState({ age: 70, year: 0, balance: 500_000 }),
      runPeriodInput({ assumptions: { ...runPeriodInput().assumptions, currentAge: 70, retirementAge: 67 } }),
    );

    expect(result.annualContribution).toBe(0);
    expect(result.balance).toBe(500_000);
  });

  it('contributes zero on zero income without special-casing it', () => {
    const result = computeIncome(
      periodState({ age: 35, year: 0, balance: 750_000 }),
      runPeriodInput({ assumptions: { ...runPeriodInput().assumptions, currentAnnualIncome: 0 } }),
    );

    expect(result.annualContribution).toBe(0);
    expect(result.balance).toBe(750_000);
  });
});

describe('computeWithdrawals', () => {
  /**
   * A retirement period state as `computeWithdrawals` now sees it: post-
   * `snapshotBeginningBalance`, PRE-`applyGrowth`. $1M at the start of the year, untouched —
   * FIN-65 change 2 put this stage ahead of growth, so `balance` and `beginningBalance`
   * coincide here and the year's return has not been earned yet.
   */
  const retiredState = (overrides: Partial<PeriodState> = {}): PeriodState =>
    periodState({
      age: 67,
      year: 0,
      beginningBalance: 1_000_000,
      balance: 1_000_000,
      investmentReturn: 0,
      ...overrides,
    });

  const retiredInput = (overrides: Partial<RunPeriodInput> = {}): RunPeriodInput =>
    runPeriodInput({
      assumptions: { ...runPeriodInput().assumptions, currentAge: 67, retirementAge: 67 },
      ...overrides,
    });

  it('withdraws nothing before retirement age', () => {
    const result = computeWithdrawals(periodState({ age: 35, year: 0, balance: 119_000 }), runPeriodInput());

    expect(result.annualWithdrawal).toBe(0);
    expect(result.balance).toBe(119_000);
    expect(result.priorWithdrawal).toBeNull();
  });

  it('resets the withdrawal to zero pre-retirement rather than leaving a stale one', () => {
    // The mirror of `computeIncome`'s retirement reset. Unreachable inside `runProjection`,
    // where age only ever increases — but `computeWithdrawals` is exported and reused, and the
    // reset is part of its contract rather than an accident of the caller's ordering.
    const result = computeWithdrawals(
      periodState({ age: 35, year: 0, balance: 119_000, annualWithdrawal: 40_000 }),
      runPeriodInput(),
    );

    expect(result.annualWithdrawal).toBe(0);
  });

  it('takes the configured rate of the first retirement year opening balance', () => {
    const result = computeWithdrawals(retiredState(), retiredInput());

    expect(result.annualWithdrawal).toBeCloseTo(40_000, 6);
  });

  it('rates the START-of-year snapshot, not whatever `balance` happens to hold', () => {
    // Inside `runPeriod` the two now coincide, because this stage runs before `applyGrowth`.
    // The stage is exported and reused, though, and reading `balance` instead of the snapshot
    // would be a live bug the moment anything moves ahead of it again — so the two are pulled
    // apart deliberately here. 4% of 1_070_000 would be 42_800; the spec says 40_000.
    const result = computeWithdrawals(retiredState({ balance: 1_070_000 }), retiredInput());

    expect(result.annualWithdrawal).not.toBeCloseTo(42_800, 6);
    expect(result.annualWithdrawal).toBeCloseTo(40_000, 6);
  });

  it('inflates the prior withdrawal in later retirement years instead of re-rating the balance', () => {
    const result = computeWithdrawals(
      retiredState({ age: 68, year: 1, priorWithdrawal: 40_000, beginningBalance: 900_000, balance: 900_000 }),
      retiredInput(),
    );

    expect(result.annualWithdrawal).toBeCloseTo(41_000, 6);
  });

  it('deducts the sourced withdrawal from the balance, before any growth is applied', () => {
    // FIN-65 change 2: 1_000_000 - 40_000 = 960_000, which `applyGrowth` then grows. The
    // old end-of-year model left 1_030_000 here (1_000_000 * 1.07 - 40_000).
    const result = computeWithdrawals(retiredState(), retiredInput());

    expect(result.balance).toBeCloseTo(960_000, 6);
  });

  it('hands the strategy the shortfall it computed, alongside the current state', () => {
    const seen: Array<{ shortfall: number; age: number }> = [];
    const spyStrategy: WithdrawalStrategy = (state, shortfall) => {
      seen.push({ shortfall, age: state.age });
      return { amount: shortfall };
    };

    computeWithdrawals(retiredState(), retiredInput({ withdrawalStrategy: spyStrategy }));

    expect(seen).toHaveLength(1);
    expect(seen[0].age).toBe(67);
    expect(seen[0].shortfall).toBeCloseTo(40_000, 6);
  });

  /**
   * The resolved decision from FIN-15's review (ERD §5, `PeriodState.priorWithdrawal`
   * TSDoc): the inflation chain compounds the *requested* figure, never the amount a
   * strategy managed to source. Invisible under `withdrawFullShortfall`, where the two are
   * equal — so it takes a deliberately partial strategy to pin it down.
   */
  it('carries the REQUESTED withdrawal forward, not the amount the strategy sourced', () => {
    const halfShortfall: WithdrawalStrategy = (_state, shortfall) => ({ amount: shortfall / 2 });

    const result = computeWithdrawals(retiredState(), retiredInput({ withdrawalStrategy: halfShortfall }));

    expect(result.priorWithdrawal).toBeCloseTo(40_000, 6);
    expect(result.annualWithdrawal).toBeCloseTo(20_000, 6);
  });

  it('reports the SOURCED withdrawal as this year withdrawal and deducts only that much', () => {
    const halfShortfall: WithdrawalStrategy = (_state, shortfall) => ({ amount: shortfall / 2 });

    const result = computeWithdrawals(retiredState(), retiredInput({ withdrawalStrategy: halfShortfall }));

    expect(result.annualWithdrawal).toBeCloseTo(20_000, 6);
    expect(result.balance).toBeCloseTo(980_000, 6);
  });

  it('keeps inflating the requested need after a shortfall rather than ratcheting spending down', () => {
    const halfShortfall: WithdrawalStrategy = (_state, shortfall) => ({ amount: shortfall / 2 });

    const first = computeWithdrawals(retiredState(), retiredInput({ withdrawalStrategy: halfShortfall }));
    const second = computeWithdrawals(
      { ...first, age: 68, year: 1, beginningBalance: first.balance },
      retiredInput({ withdrawalStrategy: halfShortfall }),
    );

    // 40_000 * 1.025 — the need, not 20_000 * 1.025 which would hide the failing plan.
    expect(second.priorWithdrawal).toBeCloseTo(41_000, 6);
  });

  /**
   * FIN-65 change 1. `inflationForPeriod` is the seam that lets a Monte Carlo trial inflate
   * spending at the SAME historical year's CPI as the return it drew for that period, rather
   * than at a flat assumption. Everything about the fallback is deliberate — see the two
   * tests below.
   */
  describe('inflationForPeriod (FIN-65)', () => {
    it('inflates the prior withdrawal at inflationForPeriod when the caller supplies one', () => {
      // 1942 CPI-U from HISTORICAL_ANNUAL_INFLATION: +10.88%. 40_000 * 1.1088 = 44_352.
      const result = computeWithdrawals(
        retiredState({ age: 68, year: 1, priorWithdrawal: 40_000, beginningBalance: 900_000, balance: 963_000 }),
        retiredInput({ inflationForPeriod: 0.1088 }),
      );

      expect(result.priorWithdrawal).toBeCloseTo(44_352, 6);
      expect(result.annualWithdrawal).toBeCloseTo(44_352, 6);
    });

    /**
     * The scope fence for FIN-65. `runProjection` never sets `inflationForPeriod`, so the
     * `??` fallback is what keeps the deterministic Plan tab — and the GBM Monte Carlo
     * branch, which has no historical year to key off — on `assumptions.inflationRate`.
     */
    it('falls back to assumptions.inflationRate when inflationForPeriod is absent', () => {
      // 40_000 * 1.025 (the plan's own 2.5%) = 41_000.
      const result = computeWithdrawals(
        retiredState({ age: 68, year: 1, priorWithdrawal: 40_000, beginningBalance: 900_000, balance: 963_000 }),
        retiredInput(),
      );

      expect(result.priorWithdrawal).toBeCloseTo(41_000, 6);
    });

    it('leaves the FIRST retirement year rated off the balance, not inflated', () => {
      // Year one is `beginningBalance * withdrawalRateInRetirement` regardless of any CPI:
      // 1_000_000 * 4% = 40_000 even with 1942's 10.88% supplied.
      const result = computeWithdrawals(retiredState(), retiredInput({ inflationForPeriod: 0.1088 }));

      expect(result.annualWithdrawal).toBeCloseTo(40_000, 6);
    });

    it('honours a zero inflationForPeriod rather than treating it as absent', () => {
      // `??` not `||`: 1929's CPI-U is exactly 0.0000, and `||` would silently substitute 2.5%.
      const result = computeWithdrawals(
        retiredState({ age: 68, year: 1, priorWithdrawal: 40_000, beginningBalance: 900_000, balance: 963_000 }),
        retiredInput({ inflationForPeriod: 0 }),
      );

      expect(result.priorWithdrawal).toBeCloseTo(40_000, 6);
    });

    it('applies a deflationary inflationForPeriod, shrinking the spending need', () => {
      // 1932 CPI-U: -10.53%. 40_000 * 0.8947 = 35_788.
      const result = computeWithdrawals(
        retiredState({ age: 68, year: 1, priorWithdrawal: 40_000, beginningBalance: 900_000, balance: 963_000 }),
        retiredInput({ inflationForPeriod: -0.1053 }),
      );

      expect(result.priorWithdrawal).toBeCloseTo(35_788, 6);
    });
  });

  it('keeps withdrawing from an exhausted portfolio rather than clamping at zero', () => {
    const result = computeWithdrawals(
      retiredState({ age: 75, year: 8, priorWithdrawal: 12_000, beginningBalance: 5_000, balance: 5_000 }),
      retiredInput(),
    );

    expect(result.annualWithdrawal).toBeCloseTo(12_300, 6);
    expect(result.balance).toBeCloseTo(-7_300, 6);
  });
});

describe('applyTax', () => {
  it('leaves the balance untouched under the Stories 1-3 zero-tax calculator', () => {
    const result = applyTax(periodState({ balance: 119_000 }), runPeriodInput());

    expect(result.balance).toBe(119_000);
  });

  it('asks the calculator about this period income, withdrawal, age and year', () => {
    const seen: Array<[number, number, TaxContext]> = [];
    const spyTax: TaxCalculator = (income, withdrawals, context) => {
      seen.push([income, withdrawals, context]);
      return { taxOwed: 0 };
    };

    applyTax(
      periodState({ age: 67, year: 32, priorIncome: 80_000, annualWithdrawal: 40_000 }),
      runPeriodInput({ taxCalculator: spyTax }),
    );

    expect(seen).toEqual([[80_000, 40_000, { age: 67, year: 32 }]]);
  });

  it('deducts what the calculator says is owed, so a real tax seam changes the ending balance', () => {
    const flatTax: TaxCalculator = () => ({ taxOwed: 9_000 });

    const result = applyTax(periodState({ balance: 119_000 }), runPeriodInput({ taxCalculator: flatTax }));

    expect(result.balance).toBe(110_000);
  });
});

describe('recordPeriod', () => {
  const recorded = (overrides: Partial<PeriodState> = {}): ProjectionRow => {
    const result = recordPeriod(
      periodState({
        age: 35,
        year: 0,
        beginningBalance: 100_000,
        investmentReturn: 7_000,
        annualContribution: 12_000,
        annualWithdrawal: 0,
        balance: 119_000,
        ...overrides,
      }),
      runPeriodInput(),
    );

    return result.rows[result.rows.length - 1];
  };

  it('appends exactly one row per period', () => {
    const existing: ProjectionRow[] = [
      { age: 34, year: -1, beginningBalance: 0, annualContribution: 0, investmentReturn: 0, annualWithdrawal: 0, endingBalance: 0 },
    ];

    const result = recordPeriod(periodState({ rows: existing }), runPeriodInput());

    expect(result.rows).toHaveLength(2);
  });

  it('records the period age and year', () => {
    expect(recorded()).toMatchObject({ age: 35, year: 0 });
  });

  it('records the balance applyGrowth snapshotted, not the running balance', () => {
    expect(recorded().beginningBalance).toBe(100_000);
  });

  it('records the investment return applyGrowth computed', () => {
    expect(recorded().investmentReturn).toBe(7_000);
  });

  it('records the contribution computeIncome computed', () => {
    expect(recorded().annualContribution).toBe(12_000);
  });

  it('records the withdrawal computeWithdrawals sourced', () => {
    expect(recorded({ annualWithdrawal: 40_000 }).annualWithdrawal).toBe(40_000);
  });

  it('records the running balance as the ending balance', () => {
    expect(recorded().endingBalance).toBe(119_000);
  });

  it('records a negative ending balance rather than flooring it', () => {
    expect(recorded({ balance: -6_950 }).endingBalance).toBe(-6_950);
  });
});

describe('runStages', () => {
  const addToBalance = (amount: number): PipelineStage => (state) => ({
    ...state,
    balance: state.balance + amount,
  });
  const scaleBalance = (factor: number): PipelineStage => (state) => ({
    ...state,
    balance: state.balance * factor,
  });

  it('feeds each stage the previous stage output, in order', () => {
    const result = runStages([addToBalance(1), scaleBalance(2)], periodState({ balance: 1 }), runPeriodInput());

    expect(result.balance).toBe(4);
  });

  it('produces a different result when the same stages run in a different order', () => {
    const result = runStages([scaleBalance(2), addToBalance(1)], periodState({ balance: 1 }), runPeriodInput());

    expect(result.balance).toBe(3);
  });

  it('returns the state untouched when there are no stages', () => {
    const state = periodState();

    expect(runStages([], state, runPeriodInput())).toEqual(state);
  });

  it('passes the period input through to every stage', () => {
    const recordReturn: PipelineStage = (state, input) => ({
      ...state,
      investmentReturn: input.returnForPeriod,
    });

    const result = runStages([recordReturn], periodState(), runPeriodInput({ returnForPeriod: 0.42 }));

    expect(result.investmentReturn).toBe(0.42);
  });
});

describe('runPeriod', () => {
  it('produces exactly one row per call, running the whole pipeline end to end', () => {
    const result = runPeriod(periodState({ age: 35, year: 0, balance: 100_000 }), runPeriodInput());

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ age: 35, year: 0, beginningBalance: 100_000, annualWithdrawal: 0 });
    expect(result.rows[0].annualContribution).toBeCloseTo(12_000, 6);
    expect(result.rows[0].investmentReturn).toBeCloseTo(7_000, 6);
    expect(result.rows[0].endingBalance).toBeCloseTo(119_000, 6);
  });

  it('leaves age and year alone — advancing to the next period is the fold job, not the pipeline', () => {
    const result = runPeriod(periodState({ age: 35, year: 0 }), runPeriodInput());

    expect(result.age).toBe(35);
    expect(result.year).toBe(0);
  });

  it('does not mutate the state it is given', () => {
    const state = periodState();

    runPeriod(state, runPeriodInput());

    expect(state).toEqual(periodState());
  });

  /**
   * Proves `runPeriod` is actually wired to `pipelineStages`, which the assertions above
   * cannot show while every stage is an identity stub — they pass just as happily against
   * a `runPeriod` that ignores the pipeline entirely.
   *
   * Works by swapping the array's *contents* rather than rebinding the identifier:
   * `readonly` is erased at compile time, so `runPeriod` reads through to whatever this
   * array holds at call time. That is also the one coupling to be aware of — if
   * `pipelineStages` is ever frozen, this `splice` throws and the test fails loudly rather
   * than silently going green.
   */
  it('invokes every stage held in pipelineStages, in order, threading each result into the next', () => {
    const mutableStages = pipelineStages as PipelineStage[];
    const realStages = [...mutableStages];
    const calls: string[] = [];
    const probe =
      (name: string): PipelineStage =>
      (state) => {
        calls.push(name);
        return { ...state, balance: state.balance + 1 };
      };

    mutableStages.splice(0, mutableStages.length, probe('first'), probe('second'), probe('third'));

    try {
      const result = runPeriod(periodState({ balance: 0 }), runPeriodInput());

      expect(calls).toEqual(['first', 'second', 'third']);
      expect(result.balance).toBe(3);
    } finally {
      mutableStages.splice(0, mutableStages.length, ...realStages);
    }
  });
});
