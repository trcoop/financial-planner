import { describe, expect, it } from 'vitest';

import { runMonteCarloTrials } from './monteCarlo';
import type { PortfolioAllocation } from './monteCarlo';
import { runProjection } from './projection';
import { computeDepletionGuidance } from './retirementSolver';
import type { PlanAssumptions } from './types';

/** A plan that's off track well before the horizon at the baseline retirement age, but resolves
 * (Monte Carlo success rate reaches the 80% bar) if the retiree works a few extra years or adds a
 * modest extra monthly contribution. Chosen so both suggestions independently resolve — most
 * tests below tweak one lever to isolate it. */
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

const allocation: PortfolioAllocation = { stocksPercent: 70, bondsPercent: 30 };

// Pinned so every test's Monte Carlo re-runs are deterministic (ERD/R1's "deterministic given the
// same seed" acceptance criterion, same as the rest of the Monte Carlo suite) — a real caller
// omits this and gets a fresh seed per `computeDepletionGuidance` call instead.
const seed = 42;

describe('computeDepletionGuidance', () => {
  it('returns no guidance for a plan whose Monte Carlo success rate already clears the bar', () => {
    const assumptions = baseAssumptions({
      currentAge: 30,
      retirementAge: 65,
      initialBalance: 500_000,
      currentAnnualIncome: 150_000,
      annualContributionRate: 0.2,
      withdrawalRateInRetirement: 0.03,
    });

    const result = computeDepletionGuidance({ assumptions, allocation, seed });

    expect(result.needsGuidance).toBe(false);
    expect(result.successRate).toBeGreaterThanOrEqual(80);
    expect(result.depletedAtAge).toBeUndefined();
    expect(result.extraYears).toBeUndefined();
    expect(result.extraContribution).toBeUndefined();
  });

  it('needs guidance when Monte Carlo clears the bar but the deterministic path still depletes within the horizon (Travis live finding: successRate 83%, deterministic depletion at 95)', () => {
    // Root cause (see retirementSolver.ts's module doc comment): `runMonteCarloTrials` prices
    // each asset class from `DEFAULT_RETURN_ASSUMPTIONS` (fixed capital-market assumptions),
    // NOT from `assumptions.annualReturnRate` — a deliberate, pre-existing decoupling shared with
    // `StressTestSection`. A conservative `annualReturnRate` well below the allocation-implied
    // blend of `DEFAULT_RETURN_ASSUMPTIONS` reproduces exactly that gap: Monte Carlo comfortably
    // clears 80% while the single fixed-return deterministic path still runs dry before the
    // horizon ends. This is the case the combined gate (Monte Carlo AND deterministic) exists to
    // catch — Monte Carlo alone would have called this plan "on track".
    const assumptions = baseAssumptions({
      currentAge: 40,
      retirementAge: 65,
      initialBalance: 300_000,
      currentAnnualIncome: 120_000,
      annualContributionRate: 0.1,
      annualReturnRate: 0.03,
      withdrawalRateInRetirement: 0.045,
      planningHorizonEndAge: 95,
    });
    const stockHeavyAllocation: PortfolioAllocation = { stocksPercent: 90, bondsPercent: 10 };

    const result = computeDepletionGuidance({ assumptions, allocation: stockHeavyAllocation, seed });

    expect(result.successRate).toBeGreaterThanOrEqual(80);
    expect(result.depletedAtAge).toBeDefined();
    expect(result.needsGuidance).toBe(true);
  });

  it('finds a resolving extra-years suggestion for a plan below the success-rate bar', () => {
    const assumptions = baseAssumptions();

    const result = computeDepletionGuidance({ assumptions, allocation, seed });

    expect(result.needsGuidance).toBe(true);
    expect(result.successRate).toBeLessThan(80);
    expect(result.extraYears?.status).toBe('found');
    if (result.extraYears?.status === 'found') {
      expect(result.extraYears.retirementAge).toBeGreaterThan(assumptions.retirementAge);
      expect(result.extraYears.extraYears).toBe(result.extraYears.retirementAge - assumptions.retirementAge);
    }
  });

  it('finds a resolving extra-monthly-contribution suggestion for a plan below the success-rate bar', () => {
    // `withdrawalRateInRetirement` alone draws a fixed PERCENTAGE of the balance at
    // retirement (`pipeline.ts`'s `computeWithdrawals`), which makes success scale-invariant to
    // the balance — boosting contributions grows the withdrawal proportionally too. A household
    // spending goal (`retirementSpendingGoal`) draws a fixed DOLLAR amount instead, decoupled
    // from balance, so a bigger corpus genuinely buys more success — this is the realistic case
    // an extra contribution actually fixes, and many pre-retirement accumulation years give the
    // search room to find it within the bound.
    const assumptions = baseAssumptions({
      currentAge: 35,
      retirementAge: 62,
      initialBalance: 150_000,
      retirementSpendingGoal: { annualAmount: 60_000 },
    });

    const result = computeDepletionGuidance({ assumptions, allocation, seed });

    expect(result.extraContribution?.status).toBe('found');
    if (result.extraContribution?.status === 'found') {
      expect(result.extraContribution.extraMonthlyContribution).toBeGreaterThan(0);
      // Rounded to the documented $10 precision.
      expect(result.extraContribution.extraMonthlyContribution % 10).toBe(0);
    }
  });

  it('extra-contribution suggestion holds up against an independent ground-truth Monte Carlo re-run and a deterministic re-run (review finding: mutation-tested Math.ceil -> Math.floor at the rounding step passed unmodified without this)', () => {
    // Same ground-truth pattern as the extra-years regression test below, applied to the
    // contribution suggestion — a reviewer found that swapping the rounding direction
    // (`Math.ceil` -> `Math.floor` in `findExtraContributionSuggestion`) passed every existing
    // test unmodified, because nothing re-verified the suggested dollar figure actually resolves
    // the plan; only that it's positive and a multiple of $10. A `Math.floor` bug would round the
    // suggestion DOWN below the amount the search actually found necessary, silently under-
    // suggesting. This test would catch that: the ground-truth batch must actually clear the bar
    // at the suggested (rounded) amount, not just at the search's own unrounded internal value.
    const assumptions = baseAssumptions({
      currentAge: 35,
      retirementAge: 62,
      initialBalance: 150_000,
      retirementSpendingGoal: { annualAmount: 60_000 },
    });

    const result = computeDepletionGuidance({ assumptions, allocation, seed });

    expect(result.extraContribution?.status).toBe('found');
    if (result.extraContribution?.status === 'found') {
      const groundTruthAssumptions: PlanAssumptions = {
        ...assumptions,
        primaryFixedContribution:
          (assumptions.primaryFixedContribution ?? 0) + result.extraContribution.extraMonthlyContribution * 12,
      };

      const groundTruth = runMonteCarloTrials(groundTruthAssumptions, allocation, undefined, [], {
        simulationCount: 2000,
        seed: 777,
      });
      // Same generous, noise-tolerant floor as the extra-years regression test — see that test's
      // comment for why an exact `>= 80` isn't the right assertion at a threshold boundary. What
      // this guards against is a suggestion that, under independent re-verification, is nowhere
      // close to resolving (the `Math.floor` mutation's failure mode), not ordinary sampling
      // noise right at 80%.
      expect(groundTruth.successRate).toBeGreaterThan(result.successRate + 15);
      expect(groundTruth.successRate).toBeGreaterThanOrEqual(70);

      // The combined on-track gate (FIN-142 follow-up) also requires the deterministic path not
      // to deplete before the horizon — verify the suggested amount clears THAT independently too,
      // not just the Monte Carlo half.
      const groundTruthRows = runProjection(groundTruthAssumptions, []);
      const groundTruthDepletedAtAge = groundTruthRows.find(
        (row) => row.endingBalance === 0 && row.age >= groundTruthAssumptions.retirementAge,
      )?.age;
      expect(groundTruthDepletedAtAge).toBeUndefined();
    }
  });

  it('extra-years suggestion holds up against an independent ground-truth Monte Carlo re-run (regression: FIN-142 bug report)', () => {
    // Ground-truth check, not another assertion against the solver's own internal logic: solve
    // for N, then independently call `runMonteCarloTrials` with `retirementAge` bumped by exactly
    // N — the same thing the real UI form does when a user manually edits their retirement age —
    // and assert THAT re-run's success rate actually clears the bar. An earlier version of this
    // solver checked a single deterministic `runProjection` path instead of Monte Carlo success
    // rate, which is what produced the original bug report: a user manually bumped their
    // retirement age by the solver's suggested N and still saw a large shortfall elsewhere on the
    // tab, because a deterministic depletion check and a probability-of-success threshold are
    // different questions. Solving for the same Monte Carlo threshold this ground-truth re-run
    // checks is the actual fix; this test pins that invariant so a future regression gets caught
    // here, not just anecdotally.
    const assumptions = baseAssumptions({
      currentAge: 35,
      retirementAge: 65,
      initialBalance: 250_000,
      currentAnnualIncome: 85_000,
      annualContributionRate: 0.15,
      annualRaiseRate: 0.03,
      annualReturnRate: 0.08,
      withdrawalRateInRetirement: 0.039,
      planningHorizonEndAge: 100,
      retirementSpendingGoal: { annualAmount: 150_000 },
    });

    const result = computeDepletionGuidance({ assumptions, allocation, seed });

    expect(result.needsGuidance).toBe(true);
    expect(result.extraYears?.status).toBe('found');
    if (result.extraYears?.status === 'found') {
      const groundTruthAssumptions: PlanAssumptions = {
        ...assumptions,
        retirementAge: assumptions.retirementAge + result.extraYears.extraYears,
      };
      // A larger, independent trial batch (not the solver's own low-precision search count) and
      // a fresh seed of its own — this must hold up as a real re-run, not merely reproduce the
      // solver's exact internal number with the same random paths.
      const groundTruth = runMonteCarloTrials(groundTruthAssumptions, allocation, undefined, [], {
        simulationCount: 2000,
        seed: 777,
      });
      // Not an exact `>= 80` — the guidance search finds the smallest candidate whose OWN
      // low-precision (200-path) estimate crosses the bar, and right at a threshold a
      // higher-precision independent re-run can land a few points either side of it from
      // ordinary Monte Carlo sampling variance alone. What this regression test actually guards
      // against is the original bug report's failure mode: a candidate the solver calls
      // "resolved" turning out, under real re-verification, to still be far short (that bug
      // produced a multi-million-dollar-shortfall-sized gap, not a few points of sampling noise).
      // A wide, generous floor well above the plan's own (much lower) starting success rate
      // catches that class of regression without being flaky on the ordinary noise at a
      // threshold boundary.
      expect(groundTruth.successRate).toBeGreaterThan(result.successRate + 15);
      expect(groundTruth.successRate).toBeGreaterThanOrEqual(70);

      // The combined on-track gate (FIN-142 follow-up: Monte Carlo AND the deterministic
      // projection) also requires the suggested retirement age's own deterministic path not to
      // deplete before the horizon — verify that independently too.
      const groundTruthRows = runProjection(groundTruthAssumptions, []);
      const groundTruthDepletedAtAge = groundTruthRows.find(
        (row) => row.endingBalance === 0 && row.age >= groundTruthAssumptions.retirementAge,
      )?.age;
      expect(groundTruthDepletedAtAge).toBeUndefined();
    }
  });

  it('reports noSolutionFound for extra years when the plan cannot be fixed by working longer within the bound', () => {
    // Retirement age already pinned at the planning horizon end age — no room to search forward.
    const assumptions = baseAssumptions({ retirementAge: 90, planningHorizonEndAge: 90, currentAge: 89 });

    const result = computeDepletionGuidance({ assumptions, allocation, seed });

    if (result.needsGuidance) {
      expect(result.extraYears?.status).toBe('noSolutionFound');
    }
  });

  it('finds an extra-years suggestion whose only resolving age is exactly the MAX_EXTRA_YEARS_SCANNED upper bound (review finding: the search loop\'s `candidateAge <= upperBound` inclusivity has no pinning test — mutating it to `<` silently drops this exact candidate and would report noSolutionFound instead)', () => {
    // A fixed-dollar spending goal (not a % withdrawal rate, which is scale-invariant against
    // extra working years — see the "extra-monthly-contribution" test above) with no ongoing
    // contribution and a large enough goal that only working all the way out to
    // `retirementAge + 40` (`MAX_EXTRA_YEARS_SCANNED`, the tighter of the two upper bounds here
    // since `planningHorizonEndAge` is set far beyond it) resolves the plan — one year short, at
    // age 104, still fails. Probed directly against the real engine (not asserted from a
    // theoretical model) to land exactly on this boundary.
    const assumptions = baseAssumptions({
      currentAge: 35,
      retirementAge: 65,
      initialBalance: 250_000,
      currentAnnualIncome: 85_000,
      annualContributionRate: 0,
      annualRaiseRate: 0.03,
      annualReturnRate: 0.08,
      withdrawalRateInRetirement: 0.039,
      planningHorizonEndAge: 200,
      retirementSpendingGoal: { annualAmount: 420_000 },
    });

    const result = computeDepletionGuidance({ assumptions, allocation, seed });

    expect(result.needsGuidance).toBe(true);
    expect(result.extraYears).toEqual({ status: 'found', retirementAge: 105, extraYears: 40 });
    // Scans all 40 candidate ages with a real Monte Carlo re-run each — legitimately expensive.
    // CI's runner is slower than local dev machines (observed ~26s vs. under vitest's 15s
    // default), so this needs an explicit longer timeout, same pattern as monteCarlo.test.ts's
    // own slow oracle-agreement test.
  }, 60000);

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

    const result = computeDepletionGuidance({ assumptions, allocation, seed });

    expect(result.needsGuidance).toBe(true);
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

    const withoutEvents = computeDepletionGuidance({ assumptions, allocation, seed });
    const withEvents = computeDepletionGuidance({ assumptions, allocation, events, seed });

    // Adding a recurring cost can only make the plan's success rate the same or worse, never
    // better.
    expect(withEvents.successRate).toBeLessThanOrEqual(withoutEvents.successRate);
  });
});
