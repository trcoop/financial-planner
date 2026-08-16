import { describe, expect, it } from 'vitest';

import { withdrawFullShortfall, zeroTax } from './strategies';
import type { PeriodState } from './types';

const periodState = (overrides: Partial<PeriodState> = {}): PeriodState => ({
  age: 67,
  year: 0,
  balance: 1_000_000,
  priorIncome: 0,
  priorWithdrawal: null,
  rows: [],
  beginningBalance: 1_000_000,
  investmentReturn: 0,
  annualContribution: 0,
  annualWithdrawal: 0,
  ...overrides,
});

describe('withdrawFullShortfall', () => {
  it('sources the entire requested shortfall from the single balance', () => {
    const plan = withdrawFullShortfall(periodState({ balance: 1_000_000 }), 40_000);

    expect(plan).toEqual({ amount: 40_000 });
  });

  it('does not clamp a shortfall that exceeds the available balance', () => {
    // Story 1 PRD: a portfolio that runs dry keeps projecting into negative territory
    // rather than stopping or flooring at zero, so this stub must not cap the draw.
    const plan = withdrawFullShortfall(periodState({ balance: 10_000 }), 40_000);

    expect(plan.amount).toBe(40_000);
  });

  it('returns a zero withdrawal when nothing is requested', () => {
    const plan = withdrawFullShortfall(periodState(), 0);

    expect(plan.amount).toBe(0);
  });

  it('does not mutate the state it is given', () => {
    const state = periodState({ balance: 1_000_000 });

    withdrawFullShortfall(state, 40_000);

    expect(state.balance).toBe(1_000_000);
  });
});

describe('zeroTax', () => {
  it('owes no tax on retirement withdrawals', () => {
    expect(zeroTax(0, 40_000, { age: 67, year: 0 })).toEqual({ taxOwed: 0 });
  });

  it('owes no tax on working-year income', () => {
    expect(zeroTax(80_000, 0, { age: 35, year: 0 })).toEqual({ taxOwed: 0 });
  });
});
