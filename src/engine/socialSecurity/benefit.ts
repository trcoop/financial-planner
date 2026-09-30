/** WP-B stubs: own benefit, FRA, legal window. Replace bodies in place; signatures are pinned. */
import type { AsOf, MonthIndex, SsPerson } from './types';
import { notImplemented } from './notImplemented';

/** FRA in months for `birthYear` (792..804). WP-B; table lives in `constants.ts`. Throws SS_NOT_IMPLEMENTED until then. */
export function fraMonths(_birthYear: number): number {
  throw notImplemented('fraMonths', 'WP-B');
}

/** `fraMonths(birthYear - 2)` semantics, defined for 1943+. WP-B. Throws SS_NOT_IMPLEMENTED until then. */
export function survivorFraMonths(_birthYear: number): number {
  throw notImplemented('survivorFraMonths', 'WP-B');
}

/** Legal claim window; `null` = empty window. WP-B. Throws SS_NOT_IMPLEMENTED until then. */
export function legalClaimWindow(_p: SsPerson, _asOf: AsOf): { earliest: MonthIndex; latest: MonthIndex } | null {
  throw notImplemented('legalClaimWindow', 'WP-B');
}

/** Steady-state (post-January) fraction of PIA. WP-B. Throws SS_NOT_IMPLEMENTED until then. */
export function ownFactorSteady(_fraMonths: number, _claimAgeMonths: number): number {
  throw notImplemented('ownFactorSteady', 'WP-B');
}

/** Fraction payable in month `at` with the January rule. WP-B. Throws SS_NOT_IMPLEMENTED until then. */
export function ownFactorAt(_p: SsPerson, _claim: MonthIndex, _at: MonthIndex): number {
  throw notImplemented('ownFactorAt', 'WP-B');
}
