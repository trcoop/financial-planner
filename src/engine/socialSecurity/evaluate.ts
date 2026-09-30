/** WP-E stubs: household orchestration, growth, scenario evaluation, top claims, crossings. */
import type { MonthIndex, SsInputs, SsResult, TopClaim, TopClaimsAxis } from './types';
import { notImplemented } from './notImplemented';

/** Own + spousal + survivor overlay. WP-E. Throws SS_NOT_IMPLEMENTED until then. */
export function computeSocialSecurity(_inputs: SsInputs): SsResult {
  throw notImplemented('computeSocialSecurity', 'WP-E');
}

/** Cumulative month-end balance; `null` rate = plain cumulative sum. WP-E. Throws SS_NOT_IMPLEMENTED until then. */
export function growthBalance(_monthlyHousehold: readonly number[], _growthRate: number | null): number[] {
  throw notImplemented('growthBalance', 'WP-E');
}

/** Lifetime total (the only total, E30). WP-E. Throws SS_NOT_IMPLEMENTED until then. */
export function evaluateScenario(_inputs: SsInputs): number {
  throw notImplemented('evaluateScenario', 'WP-E');
}

/** Internal/test helper grid evaluator. WP-E. Throws SS_NOT_IMPLEMENTED until then. */
export function evaluateGrid(_base: Omit<SsInputs, 'claimMonth'>, _axes: TopClaimsAxis[]): number[][] {
  throw notImplemented('evaluateGrid', 'WP-E');
}

/** Top-n claim combinations (n default 3). WP-E. Throws SS_NOT_IMPLEMENTED until then. */
export function topClaims(_base: Omit<SsInputs, 'claimMonth'>, _axes: TopClaimsAxis[], _n?: number): TopClaim[] {
  throw notImplemented('topClaims', 'WP-E');
}

/** PRD E11 crossing rules, pair order A-B, A-C, B-C. WP-E. Throws SS_NOT_IMPLEMENTED until then. */
export function findCrossings(
  _cumulative: readonly (readonly number[])[],
  _firstMonth: MonthIndex,
): { leader: number; trailer: number; month: MonthIndex }[] {
  throw notImplemented('findCrossings', 'WP-E');
}
