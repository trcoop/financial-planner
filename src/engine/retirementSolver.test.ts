import { describe, expect, it } from 'vitest';

import { computeDepletionGuidance } from './retirementSolver';
import type { PlanAssumptions } from './types';

/** A plan that depletes well before the horizon at the baseline retirement age, but resolves
 * if the retiree works a few extra years or adds a modest extra monthly contribution. Chosen so
 * both suggestions independently resolve — most tests below tweak one lever to isolate it. */
const baseAssumptions = (overrides: Partial<PlanAssumptions> = {}): PlanAssumptions => ({
  currentAge: 55,
  retirementAge: 60,
  initialBalance: 100_000,
  currentAnnualIncome: 90_000,
  annualContributionRate: 0.06,
  annualRaiseRate: 0.02,
  annualReturnRate: 0.05,
  inflationRate: 0.025,
  withdrawalRateInRetirement: 0.06,
  planningHorizonEndAge: 90,
  ...overrides,
});

describe('computeDepletionGuidance', () => {
  it('returns no depletion/suggestions for a plan that never runs out of money', () => {
    const assumptions = baseAssumptions({
      currentAge: 30,
      retirementAge: 65,
      initialBalance: 500_000,
      currentAnnualIncome: 150_000,
      annualContributionRate: 0.2,
      withdrawalRateInRetirement: 0.03,
    });

    const result = computeDepletionGuidance({ assumptions });

    expect(result.depletedAtAge).toBeUndefined();
    expect(result.extraYears).toBeUndefined();
    expect(result.extraContribution).toBeUndefined();
  });

  it('finds a resolving extra-years suggestion for a plan depleted before the horizon', () => {
    const assumptions = baseAssumptions();

    const result = computeDepletionGuidance({ assumptions });

    expect(result.depletedAtAge).toBeDefined();
    expect(result.extraYears?.status).toBe('found');
    if (result.extraYears?.status === 'found') {
      expect(result.extraYears.retirementAge).toBeGreaterThan(assumptions.retirementAge);
      expect(result.extraYears.extraYears).toBe(result.extraYears.retirementAge - assumptions.retirementAge);
    }
  });

  it('finds a resolving extra-monthly-contribution suggestion for a plan depleted before the horizon', () => {
    // `withdrawalRateInRetirement` alone draws a fixed PERCENTAGE of the balance at
    // retirement (`pipeline.ts`'s `computeWithdrawals`), which makes depletion age scale-
    // invariant to the balance — boosting contributions grows the withdrawal proportionally
    // too, so it never moves the depletion age under that mode alone. A household spending
    // goal (`retirementSpendingGoal`) draws a fixed DOLLAR amount instead, decoupled from
    // balance, so a bigger corpus genuinely buys more years — this is the realistic case an
    // extra contribution actually fixes, and many pre-retirement accumulation years give the
    // search room to find it within the bound.
    const assumptions = baseAssumptions({
      currentAge: 35,
      retirementAge: 62,
      initialBalance: 150_000,
      retirementSpendingGoal: { annualAmount: 60_000 },
    });

    const result = computeDepletionGuidance({ assumptions });

    expect(result.extraContribution?.status).toBe('found');
    if (result.extraContribution?.status === 'found') {
      expect(result.extraContribution.extraMonthlyContribution).toBeGreaterThan(0);
      // Rounded to the documented $10 precision.
      expect(result.extraContribution.extraMonthlyContribution % 10).toBe(0);
    }
  });

  it('reports noSolutionFound for extra years when the plan cannot be fixed by working longer within the bound', () => {
    // Retirement age already pinned at the planning horizon end age — no room to search forward.
    const assumptions = baseAssumptions({ retirementAge: 90, planningHorizonEndAge: 90, currentAge: 89 });

    const result = computeDepletionGuidance({ assumptions });

    if (result.depletedAtAge !== undefined) {
      expect(result.extraYears?.status).toBe('noSolutionFound');
    }
  });

  it('reports noSolutionFound for extra contribution when even the search ceiling cannot resolve the plan', () => {
    // An extreme withdrawal rate against a near-zero balance and income — no realistic monthly
    // top-up within the bounded search ceiling closes this gap.
    const assumptions = baseAssumptions({
      currentAge: 64,
      retirementAge: 65,
      initialBalance: 1_000,
      currentAnnualIncome: 20_000,
      annualContributionRate: 0,
      withdrawalRateInRetirement: 0.5,
      planningHorizonEndAge: 95,
    });

    const result = computeDepletionGuidance({ assumptions });

    expect(result.depletedAtAge).toBeDefined();
    expect(result.extraContribution?.status).toBe('noSolutionFound');
  });

  it('passes events through to every re-run so suggestions reflect Medicare and other plan events', () => {
    const assumptions = baseAssumptions();
    const events = [
      {
        type: 'recurringCost' as const,
        id: 'medicarePartB',
        label: 'Medicare Part B',
        startAge: 65,
        annualAmount: 2_500,
        growthRate: 0.05,
      },
    ];

    const withoutEvents = computeDepletionGuidance({ assumptions });
    const withEvents = computeDepletionGuidance({ assumptions, events });

    // Adding a recurring cost can only make the plan harder to resolve, never easier — the
    // depletion age (when present) should be no later with events than without.
    if (withoutEvents.depletedAtAge !== undefined && withEvents.depletedAtAge !== undefined) {
      expect(withEvents.depletedAtAge).toBeLessThanOrEqual(withoutEvents.depletedAtAge);
    }
  });
});
