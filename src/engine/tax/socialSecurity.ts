/**
 * Taxable Social Security per the IRS Pub 915 worksheet (IRC §86), ERD §12.2.
 *
 * Pure calculation. The thresholds are statutorily frozen and never indexed, so they live here
 * as a `policy: 'frozen'` constant rather than in `tables.ts`/`indexing.ts` (no existing
 * frozen-threshold representation there fits: the only frozen entry is the Additional Medicare
 * threshold, stored as a plain `FicaParameters` field).
 */

import { InvalidProjectionInputError } from '../errors';
import { roundHalfUp } from './rounding';
import type { FilingStatus } from './types';

interface SocialSecurityThresholds {
  /** Provisional income at or below this: nothing taxable. */
  base: number;
  /** Provisional income above this enters the 85% tier. */
  adjusted: number;
  /** Maximum taxable amount from the middle (50%) tier: 0.5 * (adjusted - base). */
  middleTierCap: number;
}

/** Frozen, unindexed. Source: IRC §86; Pub 915. HoH uses the unmarried (single) thresholds. */
export const SOCIAL_SECURITY_THRESHOLDS = {
  policy: 'frozen',
  source: 'IRC §86; Pub 915',
  unmarried: { base: 25_000, adjusted: 34_000, middleTierCap: 4_500 },
  mfj: { base: 32_000, adjusted: 44_000, middleTierCap: 6_000 },
} as const satisfies {
  policy: 'frozen';
  source: string;
  unmarried: SocialSecurityThresholds;
  mfj: SocialSecurityThresholds;
};

export interface TaxableSocialSecurityArgs {
  /** Summed gross benefits across all people on the return. */
  benefits: number;
  /** `ordinaryIncome + preferentialIncome` exactly as passed; must exclude Social Security. */
  otherAgi: number;
  taxExemptInterest: number;
  filingStatus: FilingStatus;
}

export interface TaxableSocialSecurityResult {
  provisionalIncome: number;
  /** Whole dollars, rounded half-up once after the unrounded computation. */
  taxable: number;
}

export function computeTaxableSocialSecurity(a: TaxableSocialSecurityArgs): TaxableSocialSecurityResult {
  const { benefits, otherAgi, taxExemptInterest, filingStatus } = a;

  if (benefits > 0 && filingStatus === 'mfs') {
    throw new InvalidProjectionInputError(
      'TAX_UNSUPPORTED_FILING_STATUS_FOR_SOCIAL_SECURITY',
      `Taxable Social Security is not supported for filingStatus "mfs" with benefits > 0 (the MFS worksheet is unverified and not shipped). Received benefits ${benefits}.`,
    );
  }

  const provisionalIncome = otherAgi + taxExemptInterest + 0.5 * benefits;
  if (benefits === 0) {
    return { provisionalIncome, taxable: 0 };
  }

  const t = filingStatus === 'mfj' ? SOCIAL_SECURITY_THRESHOLDS.mfj : SOCIAL_SECURITY_THRESHOLDS.unmarried;

  let unrounded: number;
  if (provisionalIncome <= t.base) {
    unrounded = 0;
  } else if (provisionalIncome <= t.adjusted) {
    unrounded = Math.min(0.5 * benefits, 0.5 * (provisionalIncome - t.base));
  } else {
    unrounded = Math.min(
      0.85 * benefits,
      0.85 * (provisionalIncome - t.adjusted) + Math.min(0.5 * benefits, t.middleTierCap),
    );
  }

  return { provisionalIncome, taxable: roundHalfUp(unrounded) };
}
