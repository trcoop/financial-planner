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
import type { PeriodState, PipelineStage, RunPeriodInput } from './types';

const periodState = (overrides: Partial<PeriodState> = {}): PeriodState => ({
  age: 35,
  year: 0,
  balance: 100_000,
  priorIncome: 0,
  priorWithdrawal: null,
  rows: [],
  beginningBalance: 100_000,
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

describe('stage stubs', () => {
  const stages: ReadonlyArray<[string, PipelineStage]> = [
    ['applyGrowth', applyGrowth],
    ['applyLifeEvents', applyLifeEvents],
    ['computeIncome', computeIncome],
    ['computeWithdrawals', computeWithdrawals],
    ['applyTax', applyTax],
    ['recordPeriod', recordPeriod],
  ];

  it.each(stages)('%s is callable and leaves the state unchanged until it is implemented', (_name, stage) => {
    const state = periodState();

    expect(stage(state, runPeriodInput())).toEqual(state);
  });

  it.each(stages)('%s does not mutate the state it is given', (_name, stage) => {
    const state = periodState();

    stage(state, runPeriodInput());

    expect(state).toEqual(periodState());
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
  it('returns a period state, so callers can fold it across a horizon', () => {
    const state = periodState();

    expect(runPeriod(state, runPeriodInput())).toEqual(state);
  });

  it('does not mutate the state it is given', () => {
    const state = periodState();

    runPeriod(state, runPeriodInput());

    expect(state).toEqual(periodState());
  });
});
