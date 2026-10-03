import { describe, expect, it } from 'vitest';

import { planCalendarYear } from './age';
import { runProjection, toTodaysDollarRows } from './projection';
import type { PlanAssumptions, PlanEvent } from './types';

const base = (overrides: Partial<PlanAssumptions> = {}): PlanAssumptions => ({
  currentAge: 60,
  retirementAge: 65,
  initialBalance: 1_000_000,
  currentAnnualIncome: 80_000,
  annualContributionRate: 0.15,
  annualRaiseRate: 0.03,
  annualReturnRate: 0.05,
  inflationRate: 0.025,
  withdrawalRateInRetirement: 0.04,
  planningHorizonEndAge: 90,
  retirementSpendingGoal: { annualAmount: 50_000 },
  ...overrides,
});

const withSs = (byYear: number[], overrides: Partial<PlanAssumptions> = {}) =>
  base({ socialSecurityIncomeByYear: byYear, ...overrides });

describe('socialSecurityIncome plumbing (FIN-168)', () => {
  it('empty/absent schedule: every row reports 0 and output is otherwise identical', () => {
    const none = runProjection(base());
    const empty = runProjection(withSs([]));
    expect(none.every((r) => r.socialSecurityIncome === 0)).toBe(true);
    expect(empty).toEqual(none);
  });

  it('offset beyond the array length is 0; indexes by plan offset', () => {
    const rows = runProjection(withSs([1, 2, 3]));
    expect(rows.slice(0, 5).map((r) => r.socialSecurityIncome)).toEqual([1, 2, 3, 0, 0]);
  });

  it('year mapping is the plan offset, whose calendar year is planCalendarYear(asOf, offset)', () => {
    const asOf = { year: 2026, month: 9 };
    expect(planCalendarYear(asOf, 1)).toBe(2027);
  });

  it('is display-only before retirement: balances unchanged by SS', () => {
    const a = runProjection(base());
    const b = runProjection(withSs([5_000, 5_000, 5_000]));
    expect(b[0].socialSecurityIncome).toBe(5_000);
    for (let i = 0; i < 5; i++) expect(b[i].endingBalance).toBe(a[i].endingBalance);
  });

  it('subtracts SS from spending in retirement and never feeds priorWithdrawal', () => {
    const none = runProjection(base());
    const rows = runProjection(withSs(Array(31).fill(20_000)));
    expect(rows[5].annualWithdrawal).toBeCloseTo(none[5].annualWithdrawal - 20_000, 6);
    expect(rows[6].annualWithdrawal).toBeCloseTo(none[6].annualWithdrawal - 20_000, 6);
    expect(rows[5].socialSecurityIncome).toBe(20_000);
  });

  it('SS above spending gives withdrawal 0 and shows the full SS amount', () => {
    const rows = runProjection(withSs(Array(31).fill(500_000)));
    expect(rows[5].annualWithdrawal).toBe(0);
    expect(rows[5].socialSecurityIncome).toBe(500_000);
  });

  it('subtracts from base + event costs, then clamps at 0', () => {
    const ev = {
      id: 'medicarePartB',
      type: 'recurringCost',
      startAge: 65,
      annualAmount: 3_000,
      growthRate: 0,
    } as PlanEvent;
    const none = runProjection(base(), [ev]);
    const rows = runProjection(withSs(Array(31).fill(10_000)), [ev]);
    expect(rows[5].annualWithdrawal).toBeCloseTo(none[5].annualWithdrawal - 10_000, 6);
  });

  it('straddle (asOf 2026-09, retire mid-year at offset 1): FULL annual SS, no proration, in display and withdrawal', () => {
    const asOf = { year: 2026, month: 9 };
    expect(planCalendarYear(asOf, 1)).toBe(2027);
    const plan = { currentAge: 64, retirementAge: 65, planningHorizonEndAge: 70 };
    const none = runProjection(base(plan));
    const rows = runProjection(withSs([0, 12_000, 24_000], plan));
    expect(rows[1].socialSecurityIncome).toBe(12_000);
    expect(rows[2].socialSecurityIncome).toBe(24_000);
    expect(rows[1].annualWithdrawal).toBeCloseTo(none[1].annualWithdrawal - 12_000, 6);
    expect(rows[2].annualWithdrawal).toBeCloseTo(none[2].annualWithdrawal - 24_000, 6);
  });

  it('rate mode (no spending goal): SS is display-only, first and later retirement years', () => {
    const plan = { retirementSpendingGoal: undefined };
    const none = runProjection(base(plan));
    const rows = runProjection(withSs(Array(31).fill(20_000), plan));
    expect(rows[5].annualWithdrawal).toBeCloseTo(rows[5].beginningBalance * 0.04, 6);
    for (const i of [5, 6, 7]) {
      expect(rows[i].annualWithdrawal).toBe(none[i].annualWithdrawal);
      expect(rows[i].endingBalance).toBe(none[i].endingBalance);
      expect(rows[i].socialSecurityIncome).toBe(20_000);
    }
  });

  it('deflates socialSecurityIncome in toTodaysDollarRows', () => {
    const rows = runProjection(withSs([0, 10_000]));
    const real = toTodaysDollarRows(rows, 0.025);
    expect(real[1].socialSecurityIncome).toBeCloseTo(10_000 / 1.025 ** 2, 6);
  });

  it('rejects non-finite or negative entries', () => {
    const codeOf = (byYear: number[]) => {
      try {
        runProjection(withSs(byYear));
      } catch (error) {
        return (error as { code?: string }).code;
      }
      return undefined;
    };
    expect(codeOf([Number.NaN])).toBe('NON_FINITE_INPUT');
    expect(codeOf([Number.POSITIVE_INFINITY])).toBe('NON_FINITE_INPUT');
    expect(codeOf([-1])).toBe('SS_NEGATIVE_BENEFIT');
  });
});
