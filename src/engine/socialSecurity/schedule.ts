/** WP-G: whole-dollar annual schedule for the plan path (ERD §12.10, §12.25.3). */
import { firstClaimableMonth } from '../age';
import { computeOwnAndSpousal } from './spousal';
import type { SsAnnualSchedule, SsInputs } from './types';

/**
 * Builds the plan-path schedule from `computeOwnAndSpousal(...).annual` (no death age, survivor 0),
 * rounding each person-year ONCE, half-up, to whole dollars. Year 0 is the full calendar year of
 * `asOf` (unlike calculator totals, which start at the asOf month). A not-yet-collecting claim at or
 * before the asOf month is clamped to `firstClaimableMonth(asOf)` rather than thrown
 * (`SS_CLAIM_IN_PAST` is calculator-path only); every other invalid input still throws.
 * Sorted by year, then personIndex.
 */
export function buildSsAnnualSchedule(inputs: Omit<SsInputs, 'deathAgeYears' | 'endYear'>, horizonEndYear: number): SsAnnualSchedule {
  const floor = firstClaimableMonth(inputs.asOf);
  const claimMonth = inputs.claimMonth.map((m, i) =>
    m !== null && m !== undefined && inputs.people[i]?.benefit.kind === 'pia' && m <= floor - 1 ? floor : m,
  );
  const { annual } = computeOwnAndSpousal({ ...inputs, claimMonth, endYear: horizonEndYear });
  const out: SsAnnualSchedule = [];
  for (const row of annual) {
    row.perPerson.forEach((p, personIndex) => {
      out.push({ year: row.year, personIndex, nominalAnnual: Math.round(p.total) });
    });
  }
  return out;
}
