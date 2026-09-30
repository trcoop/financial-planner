/** WP-G stub: whole-dollar annual schedule for the plan path. */
import type { SsAnnualSchedule, SsInputs } from './types';
import { notImplemented } from './notImplemented';

/**
 * Builds the plan-path schedule from `computeOwnAndSpousal` (no survivor), rounding half-up to
 * whole dollars once per person-year (ERD §12.3). WP-G. The input type is this ticket's pin
 * (the ERD names the function but not its parameter). Throws SS_NOT_IMPLEMENTED until then.
 */
export function buildSsAnnualSchedule(_inputs: Omit<SsInputs, 'deathAgeYears'>): SsAnnualSchedule {
  throw notImplemented('buildSsAnnualSchedule', 'WP-G');
}
