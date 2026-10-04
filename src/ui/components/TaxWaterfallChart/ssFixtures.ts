import type { FederalTaxInput } from '../../../engine'

// Social Security story/test inputs (ERD §12.2 vectors T2/T6/T7). `year: 2026` is a published
// actuals year, so output is frozen; indexing rates are therefore unused but required by the type.
const INDEXING = { chainedCpiU: 0.025, averageWageIndex: 0.03 }

function singleRetiree(otherOrdinary: number, benefits: number): FederalTaxInput {
  return {
    year: 2026,
    filingStatus: 'single',
    ordinaryIncome: otherOrdinary,
    preferentialIncome: 0,
    taxExemptInterest: 0,
    people: [{ age: 67, earnedIncome: 0, socialSecurityBenefits: benefits }],
    indexing: INDEXING,
  }
}

/** T2: provisional income 25,000, nothing taxable. */
export const SS_NONE_TAXABLE = singleRetiree(15_000, 20_000)
/** T6: provisional income 40,000, taxable 9,600. */
export const SS_PARTIAL_TAXABLE = singleRetiree(30_000, 20_000)
/** T7: provisional income 110,000, taxable capped at 85% = 17,000. */
export const SS_CAPPED_85 = singleRetiree(100_000, 20_000)
