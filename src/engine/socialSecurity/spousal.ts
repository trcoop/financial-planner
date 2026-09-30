/** WP-C stubs: spousal and the own+spousal orchestration. */
import type { MonthIndex, SsInputs, SsResult } from './types';
import { notImplemented } from './notImplemented';

/** BASE $/month spousal; 0 if excess <= 0. WP-C. Throws SS_NOT_IMPLEMENTED until then. */
export function spousalAmount(_a: {
  ownPia: number;
  otherPia: number;
  ownFraMonths: number;
  spousalStart: MonthIndex;
}): number {
  throw notImplemented('spousalAmount', 'WP-C');
}

/** Own + spousal series (survivor always 0, `deathMonths` all null). WP-C. Throws SS_NOT_IMPLEMENTED until then. */
export function computeOwnAndSpousal(_inputs: Omit<SsInputs, 'deathAgeYears'>): SsResult {
  throw notImplemented('computeOwnAndSpousal', 'WP-C');
}
