/**
 * FIN-67 bit-identical regression baseline.
 *
 * Captures the exact output of `runMonteCarloTrials` at a fixed seed, on representative
 * inputs, BEFORE the FIN-67 consolidation (shared deflation, shared ruin/clamp). The refactor
 * must not change a single value here — if it does, something disturbed the shared seeded RNG
 * stream or changed real behavior, and the fix is to find and correct that, not to update this
 * expectation (FIN-67 ticket, constraint #2).
 */
import { describe, expect, it } from 'vitest';

import { runMonteCarloTrials } from './monteCarlo';
import type { PlanAssumptions, PlanEvent } from './types';

const plan: PlanAssumptions = {
  currentAge: 45,
  retirementAge: 65,
  initialBalance: 250_000,
  currentAnnualIncome: 120_000,
  annualContributionRate: 0.12,
  annualRaiseRate: 0.025,
  annualReturnRate: 0.07,
  inflationRate: 0.025,
  withdrawalRateInRetirement: 0.04,
  planningHorizonEndAge: 95,
};

const allocation = { stocksPercent: 65, bondsPercent: 35 };

const events: PlanEvent[] = [
  {
    type: 'recurringCost',
    id: 'medicarePartB',
    label: 'Medicare Part B',
    startAge: 65,
    endAge: 95,
    annualAmount: 2400,
    growthRate: 0.055,
  },
];

describe('FIN-67 bit-identical Monte Carlo regression baseline', () => {
  it('produces an unchanged result at a fixed seed (historical return model)', () => {
    const result = runMonteCarloTrials(plan, allocation, undefined, events, {
      seed: 42,
      simulationCount: 200,
      returnModel: 'historical',
    });

    expect(JSON.stringify(result)).toMatchSnapshot();
  });

  it('produces an unchanged result at a fixed seed (gbm return model)', () => {
    const result = runMonteCarloTrials(plan, allocation, undefined, events, {
      seed: 1337,
      simulationCount: 200,
      returnModel: 'gbm',
    });

    expect(JSON.stringify(result)).toMatchSnapshot();
  });
});
