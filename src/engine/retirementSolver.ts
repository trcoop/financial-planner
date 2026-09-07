/**
 * FIN-142: actionable guidance for a plan that isn't on track to sustain its spending goal
 * through the end of its planning horizon.
 *
 * This module is new code, not a change to `projection.ts`/`monteCarlo.ts` — it composes the
 * existing, exported `runProjection` (for the informational "depleted at age X" headline) and
 * `runMonteCarloTrials` (for the actual on-track determination and guidance search) by
 * re-running them against varied `PlanAssumptions` (a different `retirementAge`, or a boosted
 * `primaryFixedContribution`) and inspecting the results. It does not modify either engine's math
 * or exported signatures.
 *
 * "On track" here means the same thing it means everywhere else in this app (`StressTestSection`,
 * the Projection tab's "Chance of success" tile): a Monte Carlo `successRate` at or above
 * {@link SUCCESS_RATE_THRESHOLD}, not a single deterministic path clearing $0. An earlier version
 * of this module gated on a deterministic `runProjection` depletion check — that produced a
 * mismatch a real user hit (FIN-142 bug report): the deterministic check said "3 more years"
 * fixes a plan whose Monte Carlo success rate was still far below what the rest of the app calls
 * "on track," because a single deterministic path and a probability-of-success threshold are
 * different questions. Solving for the same threshold the rest of the app already uses is the
 * actual fix, not a tuning tweak.
 */

import { runProjection } from './projection';
import { runMonteCarloTrials, DEFAULT_VOLATILITY_ASSUMPTIONS } from './monteCarlo';
import type { PortfolioAllocation, VolatilityAssumptions } from './monteCarlo';
import type { PlanAssumptions, PlanEvent } from './types';

export interface RetirementGuidanceInput {
  assumptions: PlanAssumptions;
  events?: PlanEvent[];
  /** The plan's stock/bond allocation — same shape `StressTestSection`/`runMonteCarloTrials`
   * already take. Required: guidance is meaningless without knowing what's being simulated. */
  allocation: PortfolioAllocation;
  /** Defaults to {@link DEFAULT_VOLATILITY_ASSUMPTIONS}, same as `runMonteCarloTrials` itself. */
  volatilityAssumptions?: VolatilityAssumptions;
  /**
   * Fixes every Monte Carlo re-run this computation makes to one random seed (test seam, and see
   * doc comment above `resolveSeed` below for why production also always pins one per call).
   * Omit in production — a fresh seed is drawn per `computeDepletionGuidance` call.
   */
  seed?: number;
}

/** The same "on track" bar the rest of the app uses (Projection tab's "Chance of success" tile,
 * `StressTestSection`) — a plan needs at least an 80% Monte Carlo success rate to not need
 * guidance here. Keeping this in one place (rather than repeating "80" at each call site) is what
 * keeps this module's determination from silently drifting out of sync with the rest of the app's
 * definition of "on track". */
const SUCCESS_RATE_THRESHOLD = 80;

/** Paths per candidate Monte Carlo re-run during guidance search — far below
 * `DEFAULT_SIMULATION_COUNT` (5000, used for the user-triggered full Stress Test run) because this
 * search calls `runMonteCarloTrials` up to ~70 times (40 candidate retirement ages, 30
 * contribution-search iterations) per computation, synchronously, on the main thread, while the
 * user is typing. 200 paths keeps a worst-case full search well under a second in practice while
 * still being enough paths for a stable success-rate estimate at the threshold this module checks
 * against — see this module's benchmark note in the PR description for the measurement that
 * picked this number. */
const GUIDANCE_SIMULATION_COUNT = 200;

/** How much further than the current `retirementAge` this module will scan looking for a
 * resolving age, on top of whatever `planningHorizonEndAge` already bounds the search to. Purely
 * a runaway-loop guard — `planningHorizonEndAge` is normally the tighter bound in practice. */
const MAX_EXTRA_YEARS_SCANNED = 40;

/** Upper bound of the extra-monthly-contribution binary search, in dollars/month. A plan that
 * can't be fixed by an extra $20k/month isn't a "just contribute a bit more" situation, so
 * beyond this the search reports `noSolutionFound` rather than proposing an unrealistic figure. */
const MAX_MONTHLY_CONTRIBUTION_SEARCH = 20_000;

/** The extra-monthly-contribution suggestion is rounded to this precision — a "$240/month" style
 * figure reads as actionable guidance; a raw binary-search float (e.g. "$238.47/month") would not. */
const CONTRIBUTION_SEARCH_PRECISION = 10;

/** Bounded iteration cap for the contribution binary search — with the search range above and
 * this many iterations the interval shrinks well past the rounding precision, so this cap is
 * never actually the limiting factor; it exists purely so the search can't loop indefinitely. */
const MAX_CONTRIBUTION_SEARCH_ITERATIONS = 30;

export type ExtraYearsSuggestion =
  | { status: 'found'; retirementAge: number; extraYears: number }
  | { status: 'noSolutionFound' };

export type ExtraContributionSuggestion =
  | { status: 'found'; extraMonthlyContribution: number }
  | { status: 'noSolutionFound' };

export interface RetirementGuidanceResult {
  /** This plan's own Monte Carlo success rate (0-100), under its own unmodified assumptions —
   * the same figure the Chance of Success tile would show for these assumptions. */
  successRate: number;
  /** `true` when `successRate` is below {@link SUCCESS_RATE_THRESHOLD} — the gate for whether
   * suggestions below are computed at all. */
  needsGuidance: boolean;
  /** The age the plan's original assumptions deplete at along ONE deterministic path (same
   * derivation the tab used before this module existed), or `undefined` if that single path
   * doesn't hit zero before `planningHorizonEndAge`. Informational only now — a headline detail
   * alongside the Monte Carlo-driven `needsGuidance` determination above, not what gates it: a
   * plan can need guidance (`successRate` below threshold) even when this one path never
   * technically hits zero, because sequence-of-returns risk shows up across paths, not in the
   * single average-return path this figure comes from. */
  depletedAtAge: number | undefined;
  /** `undefined` when `needsGuidance` is `false` — no suggestions are computed in that case. */
  extraYears: ExtraYearsSuggestion | undefined;
  extraContribution: ExtraContributionSuggestion | undefined;
}

/** One random seed shared across every Monte Carlo re-run a single `computeDepletionGuidance`
 * call makes (the base check plus every candidate in both searches). Without this, each candidate
 * would be scored against its own independent set of simulated market paths, and the search
 * (particularly the contribution binary search, which assumes resolving-at-X implies
 * resolving-at-every-amount-above-X) could see a candidate's success rate move for reasons that
 * have nothing to do with the candidate itself — just sampling noise between calls — making the
 * search unstable or non-monotonic. Sharing a seed answers a cleaner question instead: "given the
 * same simulated market environment, what's the smallest change that succeeds in it?" A fresh
 * seed is still drawn per `computeDepletionGuidance` call (or per re-render once memoized), so
 * production usage still varies run to run, same as the rest of the app's Monte Carlo usage. */
const resolveSeed = (seed: number | undefined): number => seed ?? Math.floor(Math.random() * 2 ** 32);

/** Runs a low-precision Monte Carlo batch for `assumptions` and returns its success rate (0-100). */
const successRateFor = (
  assumptions: PlanAssumptions,
  events: PlanEvent[],
  allocation: PortfolioAllocation,
  volatilityAssumptions: VolatilityAssumptions,
  seed: number,
): number =>
  runMonteCarloTrials(assumptions, allocation, volatilityAssumptions, events, {
    simulationCount: GUIDANCE_SIMULATION_COUNT,
    seed,
  }).successRate;

/** Finds the depletion age of the plan as given (unmodified assumptions/events), along the single
 * deterministic path `runProjection` produces — same derivation `RetirementSpendingTab` used
 * inline before this module existed. Informational only; see {@link RetirementGuidanceResult.depletedAtAge}. */
const findDepletedAtAge = (assumptions: PlanAssumptions, events: PlanEvent[]): number | undefined => {
  const rows = runProjection(assumptions, events);
  return rows.find((row) => row.endingBalance === 0 && row.age >= assumptions.retirementAge)?.age;
};

/** Forward integer scan for the smallest `retirementAge` (> the plan's current one) at which the
 * plan's Monte Carlo success rate reaches {@link SUCCESS_RATE_THRESHOLD}. Ages are integers, so a
 * simple scan is sufficient — no need for true bisection. Bounded by `planningHorizonEndAge` and
 * `MAX_EXTRA_YEARS_SCANNED`, whichever is tighter. */
const findExtraYearsSuggestion = (
  assumptions: PlanAssumptions,
  events: PlanEvent[],
  allocation: PortfolioAllocation,
  volatilityAssumptions: VolatilityAssumptions,
  seed: number,
): ExtraYearsSuggestion => {
  const upperBound = Math.min(assumptions.planningHorizonEndAge, assumptions.retirementAge + MAX_EXTRA_YEARS_SCANNED);

  for (let candidateAge = assumptions.retirementAge + 1; candidateAge <= upperBound; candidateAge += 1) {
    const candidateAssumptions: PlanAssumptions = { ...assumptions, retirementAge: candidateAge };
    if (successRateFor(candidateAssumptions, events, allocation, volatilityAssumptions, seed) >= SUCCESS_RATE_THRESHOLD) {
      return { status: 'found', retirementAge: candidateAge, extraYears: candidateAge - assumptions.retirementAge };
    }
  }

  return { status: 'noSolutionFound' };
};

/** Binary search over an extra monthly contribution (converted to an annual
 * `primaryFixedContribution` addition for each Monte Carlo re-run) for the smallest amount,
 * rounded up to `CONTRIBUTION_SEARCH_PRECISION`, whose success rate reaches
 * {@link SUCCESS_RATE_THRESHOLD}. Bounded by `MAX_MONTHLY_CONTRIBUTION_SEARCH` and
 * `MAX_CONTRIBUTION_SEARCH_ITERATIONS`. */
const findExtraContributionSuggestion = (
  assumptions: PlanAssumptions,
  events: PlanEvent[],
  allocation: PortfolioAllocation,
  volatilityAssumptions: VolatilityAssumptions,
  seed: number,
): ExtraContributionSuggestion => {
  const resolvesAt = (extraMonthly: number): boolean => {
    const candidateAssumptions: PlanAssumptions = {
      ...assumptions,
      primaryFixedContribution: (assumptions.primaryFixedContribution ?? 0) + extraMonthly * 12,
    };
    return successRateFor(candidateAssumptions, events, allocation, volatilityAssumptions, seed) >= SUCCESS_RATE_THRESHOLD;
  };

  if (!resolvesAt(MAX_MONTHLY_CONTRIBUTION_SEARCH)) {
    return { status: 'noSolutionFound' };
  }

  let low = 0;
  let high = MAX_MONTHLY_CONTRIBUTION_SEARCH;
  for (let iteration = 0; iteration < MAX_CONTRIBUTION_SEARCH_ITERATIONS; iteration += 1) {
    const mid = (low + high) / 2;
    if (resolvesAt(mid)) {
      high = mid;
    } else {
      low = mid;
    }
  }

  const roundedUp = Math.ceil(high / CONTRIBUTION_SEARCH_PRECISION) * CONTRIBUTION_SEARCH_PRECISION;
  return { status: 'found', extraMonthlyContribution: roundedUp };
};

/**
 * Computes actionable guidance for a plan that isn't on track (Monte Carlo success rate below
 * {@link SUCCESS_RATE_THRESHOLD}) to sustain its spending goal through
 * `assumptions.planningHorizonEndAge`: how many extra years of work, or how much extra monthly
 * contribution, would bring its success rate up to that bar. Both suggestions are computed
 * independently off the same starting point — a caller shows whichever resolve.
 *
 * Returns `needsGuidance: false` and no suggestions when the plan's own success rate already
 * meets the bar — this module never computes or shows a suggestion for a plan that doesn't need
 * one.
 */
export const computeDepletionGuidance = ({
  assumptions,
  events = [],
  allocation,
  volatilityAssumptions = DEFAULT_VOLATILITY_ASSUMPTIONS,
  seed,
}: RetirementGuidanceInput): RetirementGuidanceResult => {
  const sharedSeed = resolveSeed(seed);
  const successRate = successRateFor(assumptions, events, allocation, volatilityAssumptions, sharedSeed);
  const depletedAtAge = findDepletedAtAge(assumptions, events);

  if (successRate >= SUCCESS_RATE_THRESHOLD) {
    return { successRate, needsGuidance: false, depletedAtAge: undefined, extraYears: undefined, extraContribution: undefined };
  }

  return {
    successRate,
    needsGuidance: true,
    depletedAtAge,
    extraYears: findExtraYearsSuggestion(assumptions, events, allocation, volatilityAssumptions, sharedSeed),
    extraContribution: findExtraContributionSuggestion(assumptions, events, allocation, volatilityAssumptions, sharedSeed),
  };
};
