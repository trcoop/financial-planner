/**
 * FIN-142: actionable guidance for a plan that runs out of money before the end of its planning
 * horizon.
 *
 * This module is new code, not a change to `projection.ts`/`ruin.ts` — it composes the existing,
 * exported `runProjection` by re-running it against varied `PlanAssumptions` (a different
 * `retirementAge`, or a boosted `primaryFixedContribution`) and inspecting the resulting
 * `ProjectionRow[]`. It does not modify the projection engine's math or exported signatures, and
 * is a sibling of `retirementNumber.ts` in that sense: pure, framework-agnostic, and standalone —
 * but unlike `retirementNumber.ts` it deliberately IS built on the real plan engine
 * (`runProjection`), since these suggestions need to reflect Medicare and other `PlanEvent`s,
 * not a simplified accumulation model.
 */

import { runProjection } from './projection';
import type { PlanAssumptions, PlanEvent } from './types';

export interface RetirementGuidanceInput {
  assumptions: PlanAssumptions;
  events?: PlanEvent[];
}

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
  /** The age the plan's original assumptions actually deplete at, or `undefined` if it doesn't
   * deplete before `planningHorizonEndAge`. Mirrors the inline derivation the tab already used
   * (first `endingBalance === 0` row at/after `retirementAge`) so the two never disagree. */
  depletedAtAge: number | undefined;
  /** `undefined` when the plan isn't depleted — no suggestions are computed in that case. */
  extraYears: ExtraYearsSuggestion | undefined;
  extraContribution: ExtraContributionSuggestion | undefined;
}

/** True when re-running the projection under `assumptions`/`events` produces no zero
 * `endingBalance` before `planningHorizonEndAge` — i.e. the plan lasts the full horizon. */
const isResolved = (assumptions: PlanAssumptions, events: PlanEvent[]): boolean => {
  const rows = runProjection(assumptions, events);
  return !rows.some((row) => row.endingBalance === 0 && row.age < assumptions.planningHorizonEndAge);
};

/** Finds the depletion age of the plan as given (unmodified assumptions/events) — same
 * derivation `RetirementSpendingTab` used inline before this module existed. */
const findDepletedAtAge = (assumptions: PlanAssumptions, events: PlanEvent[]): number | undefined => {
  const rows = runProjection(assumptions, events);
  return rows.find((row) => row.endingBalance === 0 && row.age >= assumptions.retirementAge)?.age;
};

/** Forward integer scan for the smallest `retirementAge` (> the plan's current one) at which the
 * plan resolves. Ages are integers, so a simple scan is sufficient — no need for true bisection.
 * Bounded by `planningHorizonEndAge` and `MAX_EXTRA_YEARS_SCANNED`, whichever is tighter. */
const findExtraYearsSuggestion = (assumptions: PlanAssumptions, events: PlanEvent[]): ExtraYearsSuggestion => {
  const upperBound = Math.min(assumptions.planningHorizonEndAge, assumptions.retirementAge + MAX_EXTRA_YEARS_SCANNED);

  for (let candidateAge = assumptions.retirementAge + 1; candidateAge <= upperBound; candidateAge += 1) {
    const candidateAssumptions: PlanAssumptions = { ...assumptions, retirementAge: candidateAge };
    if (isResolved(candidateAssumptions, events)) {
      return { status: 'found', retirementAge: candidateAge, extraYears: candidateAge - assumptions.retirementAge };
    }
  }

  return { status: 'noSolutionFound' };
};

/** Binary search over an extra monthly contribution (converted to an annual
 * `primaryFixedContribution` addition for each `runProjection` re-run) for the smallest amount,
 * rounded up to `CONTRIBUTION_SEARCH_PRECISION`, that resolves the plan. Bounded by
 * `MAX_MONTHLY_CONTRIBUTION_SEARCH` and `MAX_CONTRIBUTION_SEARCH_ITERATIONS`. */
const findExtraContributionSuggestion = (
  assumptions: PlanAssumptions,
  events: PlanEvent[],
): ExtraContributionSuggestion => {
  const resolvesAt = (extraMonthly: number): boolean => {
    const candidateAssumptions: PlanAssumptions = {
      ...assumptions,
      primaryFixedContribution: (assumptions.primaryFixedContribution ?? 0) + extraMonthly * 12,
    };
    return isResolved(candidateAssumptions, events);
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
 * Computes actionable guidance for a plan that depletes before `assumptions.planningHorizonEndAge`:
 * how many extra years of work, or how much extra monthly contribution, would make it last the
 * full horizon. Both suggestions are computed independently off the same depleted state — a
 * caller shows whichever resolve.
 *
 * Returns `depletedAtAge: undefined` and no suggestions when the plan already lasts the full
 * horizon under its own assumptions — this module never computes or shows a suggestion for a
 * plan that doesn't need one.
 */
export const computeDepletionGuidance = ({ assumptions, events = [] }: RetirementGuidanceInput): RetirementGuidanceResult => {
  const depletedAtAge = findDepletedAtAge(assumptions, events);

  if (depletedAtAge === undefined) {
    return { depletedAtAge: undefined, extraYears: undefined, extraContribution: undefined };
  }

  return {
    depletedAtAge,
    extraYears: findExtraYearsSuggestion(assumptions, events),
    extraContribution: findExtraContributionSuggestion(assumptions, events),
  };
};
