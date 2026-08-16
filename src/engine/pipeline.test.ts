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
} from './pipeline';
import { withdrawFullShortfall, zeroTax } from './strategies';
import type { PeriodState, PipelineStage, ProjectionRow, RunPeriodInput } from './types';

const periodState = (overrides: Partial<PeriodState> = {}): PeriodState => ({
  age: 35,
  year: 0,
  balance: 100_000,
  priorIncome: 0,
  priorWithdrawal: null,
  rows: [],
  // Deliberately different from `balance` so that a stage which sets `beginningBalance`
  // from `balance` — a half-implemented `applyGrowth` — is caught by the identity
  // assertions below rather than passing as "still a stub".
  beginningBalance: 42_000,
  investmentReturn: 0,
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
    expect(pipelineStages).toEqual([
      applyGrowth,
      applyLifeEvents,
      computeIncome,
      computeWithdrawals,
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

  it('snapshots the incoming balance as this period beginning balance', () => {
    const result = applyGrowth(periodState({ balance: 100_000 }), runPeriodInput({ returnForPeriod: 0.07 }));

    expect(result.beginningBalance).toBe(100_000);
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

    expect(result.beginningBalance).toBe(-50_000);
    expect(result.investmentReturn).toBeCloseTo(-3_500, 6);
    expect(result.balance).toBeCloseTo(-53_500, 6);
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
