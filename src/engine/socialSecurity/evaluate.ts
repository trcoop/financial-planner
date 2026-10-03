/** WP-E stubs: household orchestration, growth, scenario evaluation, top claims, crossings. */
import type { SsInputs, TopClaim, TopClaimsAxis } from './types';
import { notImplemented } from './notImplemented';

// WP-E1 (FIN-167) implementations live in their own files; this module re-exports them so the
// barrel (`index.ts`) is unchanged. `evaluateGrid` / `topClaims` (FIN-180) stay stubs below.
export { findCrossings } from './crossings';
export { growthBalance } from './growth';
export { computeSocialSecurity } from './household';
export { evaluateScenario } from './scenario';

/** Internal/test helper grid evaluator. WP-E. Throws SS_NOT_IMPLEMENTED until then. */
export function evaluateGrid(_base: Omit<SsInputs, 'claimMonth'>, _axes: TopClaimsAxis[]): number[][] {
  throw notImplemented('evaluateGrid', 'WP-E');
}

/** Top-n claim combinations (n default 3). WP-E. Throws SS_NOT_IMPLEMENTED until then. */
export function topClaims(_base: Omit<SsInputs, 'claimMonth'>, _axes: TopClaimsAxis[], _n?: number): TopClaim[] {
  throw notImplemented('topClaims', 'WP-E');
}

