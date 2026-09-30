/** WP-D stub: survivor benefit. */
import type { SurvivorArgs } from './types';
import { notImplemented } from './notImplemented';

/** BASE $/month at the survivor start (ERD §12.4). WP-D. Throws SS_NOT_IMPLEMENTED until then. */
export function survivorBreakdown(_a: SurvivorArgs): {
  base: number;
  ageReduced: number;
  cap: number | null;
  amount: number;
} {
  throw notImplemented('survivorBreakdown', 'WP-D');
}
