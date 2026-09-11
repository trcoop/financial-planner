/**
 * WP-C: statutory data tables + `resolveTables` (ERD §6.5, §9.1, §10.2).
 *
 * This module owns the actual dollar figures the federal tax engine computes against. Every
 * `IndexedAmount`/`IndexedLadder` entry below carries its own `policy`/`source`/`confidence` so
 * provenance travels with the number, not in a separate doc that can drift. Per §9.1's resolution,
 * no entry shipped here is ever `confidence: 'unconfirmed'` — an unverifiable figure means the
 * whole filing status is omitted from `TAX_TABLES` and recorded in `UNSUPPORTED_FILING_STATUSES`
 * instead (`tables.test.ts` enforces this mechanically).
 *
 * Figures verified against Rev. Proc. 2025-32 (tax year 2026) and cited statutes per WP-0's
 * research (FIN-143). `FIRST_SUPPORTED_YEAR` is the first (and, for now, only) published year;
 * years beyond it compound forward via `indexing.ts` (WP-B2), which this module calls but never
 * reimplements.
 */

import { InvalidProjectionInputError } from '../errors';
import { resolveIndexedAmount, resolveIndexedLadder } from './indexing';
import type {
  FicaParameters,
  FilingStatus,
  IndexedAmount,
  IndexedLadder,
  IndexingRates,
  Ladder,
  ResolvedYearTables,
  SeniorBonusParameters,
} from './types';

/** First calendar year this build carries a published Rev. Proc. table for. Every entry's
 * `published` record must be contiguous from this year to its own last published year
 * (`tables.test.ts`). */
export const FIRST_SUPPORTED_YEAR = 2026;

function ladder(bands: ReadonlyArray<readonly [rate: number, lowerBound: number, upperBound: number]>): Ladder {
  return bands.map(([rate, lowerBound, upperBound]) => ({ rate, lowerBound, upperBound }));
}

// -------------------------------------------------------------------------------------------
// Shared (non-filing-status-dependent) FICA parameters.
// -------------------------------------------------------------------------------------------

/** The Social Security wage base, Medicare rate, and the two statutory rates apply per WORKER /
 * per statute, not per filing status — only the Additional Medicare Tax threshold varies by
 * status (see each per-status table below). */
export const SHARED_FICA_ENTRIES: {
  socialSecurityRate: IndexedAmount;
  socialSecurityWageBase: IndexedAmount;
  medicareRate: IndexedAmount;
  additionalMedicareRate: IndexedAmount;
} = {
  socialSecurityRate: {
    published: { 2026: 0.062 },
    policy: { kind: 'statutory-rate' },
    source: 'IRC §3101(a); §3111(a)',
    confidence: 'confirmed',
  },
  socialSecurityWageBase: {
    published: { 2026: 184_500 },
    policy: { kind: 'average-wage-index', rounding: { kind: 'nearest', increment: 300 }, lagYears: 2 },
    source: '42 U.S.C. §430(b); SSA 2026 wage base announcement',
    confidence: 'confirmed',
  },
  medicareRate: {
    published: { 2026: 0.0145 },
    policy: { kind: 'statutory-rate' },
    source: 'IRC §3101(b)(1); §3111(b)',
    confidence: 'confirmed',
  },
  additionalMedicareRate: {
    published: { 2026: 0.009 },
    policy: { kind: 'statutory-rate' },
    source: 'IRC §3101(b)(2)',
    confidence: 'confirmed',
  },
};

// -------------------------------------------------------------------------------------------
// Per-filing-status tables.
// -------------------------------------------------------------------------------------------

interface RawFilingStatusTable {
  ordinaryLadder: IndexedLadder;
  preferentialLadder: IndexedLadder;
  standardDeductionBase: IndexedAmount;
  ageAdditionPerQualifyingPerson: IndexedAmount;
  seniorBonus: SeniorBonusParameters;
  additionalMedicareThreshold: IndexedAmount;
}

const UNMARRIED_SENIOR_BONUS: SeniorBonusParameters = {
  amountPerQualifyingPerson: 6_000,
  phaseOutStart: 75_000,
  phaseOutEnd: 175_000,
  phaseOutRate: 0.06,
  lastApplicableYear: 2028,
  firstApplicableYear: 2025,
};

const MFS_SENIOR_BONUS: SeniorBonusParameters = {
  amountPerQualifyingPerson: 0,
  phaseOutStart: 0,
  phaseOutEnd: 0,
  phaseOutRate: 0.06,
  lastApplicableYear: 2028,
  firstApplicableYear: 2025,
};

export const TAX_TABLES: Readonly<Partial<Record<FilingStatus, RawFilingStatusTable>>> = {
  single: {
    ordinaryLadder: {
      published: {
        2026: ladder([
          [0.1, 0, 12_400],
          [0.12, 12_400, 50_400],
          [0.22, 50_400, 105_700],
          [0.24, 105_700, 201_775],
          [0.32, 201_775, 256_225],
          [0.35, 256_225, 640_600],
          [0.37, 640_600, Infinity],
        ]),
      },
      policy: { kind: 'chained-cpi-u', baseYear: 2016, rounding: { kind: 'truncate', increment: 50 } },
      source: 'Rev. Proc. 2025-32 §4.01 Table 3 (unmarried individuals)',
      confidence: 'confirmed',
    },
    preferentialLadder: {
      published: {
        2026: ladder([
          [0, 0, 49_450],
          [0.15, 49_450, 545_500],
          [0.2, 545_500, Infinity],
        ]),
      },
      policy: { kind: 'chained-cpi-u', baseYear: 2017, rounding: { kind: 'truncate', increment: 50 } },
      source: 'Rev. Proc. 2025-32 §4.03 Table 1 (unmarried individuals)',
      confidence: 'confirmed',
    },
    standardDeductionBase: {
      published: { 2026: 16_100 },
      policy: { kind: 'chained-cpi-u', baseYear: 2016, rounding: { kind: 'truncate', increment: 50 } },
      source: 'Rev. Proc. 2025-32 §4.02; IRC §63(c)(4)',
      confidence: 'confirmed',
    },
    ageAdditionPerQualifyingPerson: {
      published: { 2026: 2_000 },
      policy: { kind: 'chained-cpi-u', baseYear: 2016, rounding: { kind: 'truncate', increment: 50 } },
      source: 'Rev. Proc. 2025-32 §4.02; IRC §63(c)(4)/(f); §151(d)(4)(A)',
      confidence: 'confirmed',
    },
    seniorBonus: UNMARRIED_SENIOR_BONUS,
    additionalMedicareThreshold: {
      published: { 2026: 200_000 },
      policy: { kind: 'frozen' },
      source: 'IRC §3101(b)(2) (frozen, unindexed)',
      confidence: 'confirmed',
    },
  },
  mfj: {
    ordinaryLadder: {
      published: {
        2026: ladder([
          [0.1, 0, 24_800],
          [0.12, 24_800, 100_800],
          [0.22, 100_800, 211_400],
          [0.24, 211_400, 403_550],
          [0.32, 403_550, 512_450],
          [0.35, 512_450, 768_700],
          [0.37, 768_700, Infinity],
        ]),
      },
      policy: { kind: 'chained-cpi-u', baseYear: 2016, rounding: { kind: 'truncate', increment: 50 } },
      source: 'Rev. Proc. 2025-32 §4.01 Table 1 (married filing jointly / surviving spouses)',
      confidence: 'confirmed',
    },
    preferentialLadder: {
      published: {
        2026: ladder([
          [0, 0, 98_900],
          [0.15, 98_900, 613_700],
          [0.2, 613_700, Infinity],
        ]),
      },
      policy: { kind: 'chained-cpi-u', baseYear: 2017, rounding: { kind: 'truncate', increment: 50 } },
      source: 'Rev. Proc. 2025-32 §4.03 Table 1 (married filing jointly / surviving spouses)',
      confidence: 'confirmed',
    },
    standardDeductionBase: {
      published: { 2026: 32_200 },
      policy: { kind: 'chained-cpi-u', baseYear: 2016, rounding: { kind: 'truncate', increment: 50 } },
      source: 'Rev. Proc. 2025-32 §4.02; IRC §63(c)(4)',
      confidence: 'confirmed',
    },
    ageAdditionPerQualifyingPerson: {
      published: { 2026: 1_600 },
      policy: { kind: 'chained-cpi-u', baseYear: 2016, rounding: { kind: 'truncate', increment: 50 } },
      source: 'Rev. Proc. 2025-32 §4.02; IRC §63(c)(4)/(f); §151(d)(4)(A)',
      confidence: 'confirmed',
    },
    seniorBonus: {
      amountPerQualifyingPerson: 6_000,
      phaseOutStart: 150_000,
      phaseOutEnd: 250_000,
      phaseOutRate: 0.06,
      lastApplicableYear: 2028,
      firstApplicableYear: 2025,
    },
    additionalMedicareThreshold: {
      published: { 2026: 250_000 },
      policy: { kind: 'frozen' },
      source: 'IRC §3101(b)(2) (frozen, unindexed)',
      confidence: 'confirmed',
    },
  },
  mfs: {
    ordinaryLadder: {
      published: {
        2026: ladder([
          [0.1, 0, 12_400],
          [0.12, 12_400, 50_400],
          [0.22, 50_400, 105_700],
          [0.24, 105_700, 201_775],
          [0.32, 201_775, 256_225],
          [0.35, 256_225, 384_350],
          [0.37, 384_350, Infinity],
        ]),
      },
      policy: { kind: 'chained-cpi-u', baseYear: 2016, rounding: { kind: 'truncate', increment: 25 } },
      source: 'Rev. Proc. 2025-32 §4.01 Table 4 (married filing separately)',
      confidence: 'confirmed',
    },
    preferentialLadder: {
      published: {
        2026: ladder([
          [0, 0, 49_450],
          [0.15, 49_450, 306_850],
          [0.2, 306_850, Infinity],
        ]),
      },
      policy: { kind: 'chained-cpi-u', baseYear: 2017, rounding: { kind: 'truncate', increment: 25 } },
      source: 'Rev. Proc. 2025-32 §4.03 (married filing separately)',
      confidence: 'confirmed',
    },
    standardDeductionBase: {
      published: { 2026: 16_100 },
      // MFS standard deduction is a documented statutory carve-out to $50, not the general
      // MFS-truncates-to-$25 rule (§1(f)(7) generally; §1(f)(7)(B) here).
      policy: { kind: 'chained-cpi-u', baseYear: 2016, rounding: { kind: 'truncate', increment: 50 } },
      source: 'Rev. Proc. 2025-32 §4.02; IRC §1(f)(7)(B)',
      confidence: 'confirmed',
    },
    ageAdditionPerQualifyingPerson: {
      published: { 2026: 1_600 },
      // Same §1(f)(7)(B) carve-out applies to the age-65 addition (§151(d)(4)(A)).
      policy: { kind: 'chained-cpi-u', baseYear: 2016, rounding: { kind: 'truncate', increment: 50 } },
      source: 'Rev. Proc. 2025-32 §4.02; IRC §63(c)(4)/(f); §1(f)(7)(B); §151(d)(4)(A)',
      confidence: 'confirmed',
    },
    seniorBonus: MFS_SENIOR_BONUS,
    additionalMedicareThreshold: {
      published: { 2026: 125_000 },
      policy: { kind: 'frozen' },
      source: 'IRC §3101(b)(2) (frozen, unindexed)',
      confidence: 'confirmed',
    },
  },
  hoh: {
    ordinaryLadder: {
      published: {
        2026: ladder([
          [0.1, 0, 17_700],
          [0.12, 17_700, 67_450],
          [0.22, 67_450, 105_700],
          [0.24, 105_700, 201_750],
          [0.32, 201_750, 256_200],
          [0.35, 256_200, 640_600],
          [0.37, 640_600, Infinity],
        ]),
      },
      policy: { kind: 'chained-cpi-u', baseYear: 2016, rounding: { kind: 'truncate', increment: 50 } },
      source: 'Rev. Proc. 2025-32 §4.01 Table 2 (heads of households)',
      confidence: 'confirmed',
    },
    preferentialLadder: {
      published: {
        2026: ladder([
          [0, 0, 66_200],
          [0.15, 66_200, 579_600],
          [0.2, 579_600, Infinity],
        ]),
      },
      policy: { kind: 'chained-cpi-u', baseYear: 2017, rounding: { kind: 'truncate', increment: 50 } },
      source: 'Rev. Proc. 2025-32 §4.03 Table 2 (heads of households)',
      confidence: 'confirmed',
    },
    standardDeductionBase: {
      published: { 2026: 24_150 },
      policy: { kind: 'chained-cpi-u', baseYear: 2016, rounding: { kind: 'truncate', increment: 50 } },
      source: 'Rev. Proc. 2025-32 §4.02; IRC §63(c)(4)',
      confidence: 'confirmed',
    },
    ageAdditionPerQualifyingPerson: {
      published: { 2026: 2_000 },
      policy: { kind: 'chained-cpi-u', baseYear: 2016, rounding: { kind: 'truncate', increment: 50 } },
      source: 'Rev. Proc. 2025-32 §4.02; IRC §63(c)(4)/(f); §151(d)(4)(A)',
      confidence: 'confirmed',
    },
    // HOH shares the UNMARRIED senior-bonus threshold with 'single' (IRC §151(d)(5)(C)(ii) applies
    // to any unmarried taxpayer, not solely single filers) — same figures, same source.
    // UNCONFIRMED: no primary/statutory source located for HOH's $75k/$175k
    // senior-bonus phase-out thresholds (secondary sources agree). See FIN-143.
    seniorBonus: UNMARRIED_SENIOR_BONUS,
    additionalMedicareThreshold: {
      published: { 2026: 200_000 },
      policy: { kind: 'frozen' },
      source: 'IRC §3101(b)(2) (frozen, unindexed); shares the unmarried threshold with "single"',
      confidence: 'confirmed',
    },
  },
};

/**
 * Statuses this build has no verified ORDINARY bracket table for, mapped to the reason: what
 * could not be verified, and against which source it was attempted. EMPTY in the expected case
 * (WP-0 verified all four against Rev. Proc. 2025-32 — see FIN-143). A status listed here is also
 * absent from `TAX_TABLES`; the two are kept consistent by the authoring test (§6.5).
 */
export const UNSUPPORTED_FILING_STATUSES: Readonly<Partial<Record<FilingStatus, string>>> = {};

/**
 * `resolveTables`'s first statement (§9.1). Throws `InvalidProjectionInputError` with
 * `TAX_FILING_STATUS_UNVERIFIED` when `filingStatus` has no verified ordinary bracket table.
 *
 * Takes `unsupported` as a parameter (rather than reading the module const directly) so it is
 * testable independently of WP-0's actual verdict: `tables.test.ts` calls it with a literal
 * `{ mfs: '...' }` and with `{}` to exercise both the throw and the pass-through, in the expected
 * case where every status verifies.
 */
export function assertFilingStatusSupported(
  filingStatus: FilingStatus,
  unsupported: Readonly<Partial<Record<FilingStatus, string>>>,
): void {
  const reason = unsupported[filingStatus];
  if (reason !== undefined) {
    throw new InvalidProjectionInputError(
      'TAX_FILING_STATUS_UNVERIFIED',
      `filingStatus must be one of the statuses this engine has verified tables for; "${filingStatus}" is not among them (${reason}). Received "${filingStatus}".`,
    );
  }
}

/**
 * Resolves every indexed figure for `(year, filingStatus)` into a concrete `ResolvedYearTables`.
 * First statement is `assertFilingStatusSupported` (§9.1) — everything below it may assume the
 * status is present in `TAX_TABLES`.
 */
export function resolveTables(
  year: number,
  filingStatus: FilingStatus,
  indexing: IndexingRates,
): ResolvedYearTables {
  assertFilingStatusSupported(filingStatus, UNSUPPORTED_FILING_STATUSES);

  // Guaranteed present: `assertFilingStatusSupported` above already refused any status absent
  // from `TAX_TABLES` (the authoring test pins that the two stay in agreement).
  const table = TAX_TABLES[filingStatus] as RawFilingStatusTable;

  const ordinaryLadder = resolveIndexedLadder(table.ordinaryLadder, year, indexing);
  const preferentialLadder = resolveIndexedLadder(table.preferentialLadder, year, indexing);
  const standardDeductionBase = resolveIndexedAmount(table.standardDeductionBase, year, indexing);
  const ageAdditionPerQualifyingPerson = resolveIndexedAmount(
    table.ageAdditionPerQualifyingPerson,
    year,
    indexing,
  );

  const fica: FicaParameters = {
    socialSecurityRate: resolveIndexedAmount(SHARED_FICA_ENTRIES.socialSecurityRate, year, indexing),
    socialSecurityWageBase: resolveIndexedAmount(SHARED_FICA_ENTRIES.socialSecurityWageBase, year, indexing),
    medicareRate: resolveIndexedAmount(SHARED_FICA_ENTRIES.medicareRate, year, indexing),
    additionalMedicareRate: resolveIndexedAmount(SHARED_FICA_ENTRIES.additionalMedicareRate, year, indexing),
    additionalMedicareThreshold: resolveIndexedAmount(table.additionalMedicareThreshold, year, indexing),
  };

  return {
    year,
    filingStatus,
    ordinaryLadder,
    preferentialLadder,
    standardDeductionBase,
    ageAdditionPerQualifyingPerson,
    seniorBonus: table.seniorBonus,
    fica,
  };
}
