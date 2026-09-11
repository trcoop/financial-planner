/**
 * WP-E: Social Security, Medicare, and Additional Medicare Tax (ERD §4.2, §5.7).
 *
 * Pure calculation, no React, no I/O. Value-indifferent about where `FicaParameters`' numbers
 * come from — that's `tables.ts` (WP-C), not imported here.
 */

import { allocateRounding, roundHalfUp } from './rounding';
import type { FicaBreakdown, FicaParameters, TaxPayer } from './types';

/**
 * Computes the FICA breakdown for one household.
 *
 * Per ERD §4.2:
 * - Social Security is capped at `params.socialSecurityWageBase` SEPARATELY PER PERSON, then
 *   summed — a household scalar would understate tax by up to a full wage base on any
 *   dual-earner joint return (see `TaxPayer.earnedIncome`'s doc comment in `types.ts`).
 * - Medicare is uncapped, per person, then summed.
 * - Additional Medicare is 0.9% of COMBINED household earned income above the per-return
 *   statutory threshold that `params.additionalMedicareThreshold` already encodes for this
 *   filing status (frozen, unindexed — resolved by the caller, not this function).
 *
 * Rounding (§5.7): the three raw (unrounded) components are allocated against the half-up
 * rounded total via `allocateRounding`, so `socialSecurity + medicare + additionalMedicare ===
 * total` holds as EXACT integer equality (P13) rather than merely "off by at most a dollar".
 *
 * `additionalMedicare` is never the rounding-remainder recipient: for any earned income, its
 * raw value is `additionalMedicareRate * max(0, combined - threshold)`, which is at most
 * `additionalMedicareRate * combined` — strictly less than `medicareRate * combined` (the raw
 * Medicare value) whenever `additionalMedicareRate < medicareRate`, which holds for every
 * published rate pair. Medicare's raw value is therefore always >= Additional Medicare's, so
 * `allocateRounding`'s "largest raw component wins the remainder" rule can never land on
 * Additional Medicare — it's passed last in the array as an extra structural guard, not as the
 * thing making this true.
 */
export function computeFica(params: FicaParameters, people: readonly TaxPayer[]): FicaBreakdown {
  const socialSecurityRaw = people.reduce(
    (sum, p) =>
      sum + Math.min(p.earnedIncome, params.socialSecurityWageBase) * params.socialSecurityRate,
    0,
  );

  const medicareRaw = people.reduce((sum, p) => sum + p.earnedIncome * params.medicareRate, 0);

  const combinedEarnedIncome = people.reduce((sum, p) => sum + p.earnedIncome, 0);
  const additionalMedicareRaw =
    Math.max(0, combinedEarnedIncome - params.additionalMedicareThreshold) *
    params.additionalMedicareRate;

  const total = roundHalfUp(socialSecurityRaw + medicareRaw + additionalMedicareRaw);

  const [socialSecurity, medicare, additionalMedicare] = allocateRounding(
    [socialSecurityRaw, medicareRaw, additionalMedicareRaw],
    total,
  );

  return { socialSecurity, medicare, additionalMedicare, total };
}
