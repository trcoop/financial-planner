import type { PlanEvent } from '../engine'

/**
 * The Medicare Part B event, wired unconditionally into every plan (Events & Medicare Cost
 * PRD's "no opt-in/opt-out" requirement; ERD §5). Starts at age 65 regardless of the plan's
 * retirement age, runs through the plan horizon (`endAge: undefined`), recurs annually.
 *
 * `annualAmount`: CMS's CY2026 standard Part B monthly premium is $202.90 ($2,434.80/yr), a
 * $17.90/mo increase from 2025's $185.00, per the CMS CY2026 Medicare Deductible, Coinsurance
 * & Premium Rates update (Federal Register, Nov 2025) — the *standard* premium (pre-IRMAA),
 * consistent with the PRD's IRMAA non-goal.
 *
 * `growthRate`: 5.5%, matching the long-run (since-1948) average annual growth of BLS
 * medical-care CPI (~5.3%) cited in the Peterson-KFF Health System Tracker's medical-vs-
 * general-inflation comparison, rounded to a clean figure in the same spirit as this
 * codebase's other calibrated defaults. This is the deterministic/GBM-branch rate — Monte
 * Carlo's historical branch instead samples `HISTORICAL_ANNUAL_MEDICAL_INFLATION` per period
 * (WP-2), falling back to this constant when there's no historical year to draw from.
 *
 * The engine has no knowledge that this event is "Medicare" — it just runs whatever `events`
 * array it's given (ERD §5). This constant is the UI-side call-site wiring that makes it so.
 */
export const MEDICARE_PART_B_EVENT: Extract<PlanEvent, { type: 'recurringCost' }> = {
  type: 'recurringCost',
  id: 'medicarePartB',
  label: 'Medicare Part B',
  startAge: 65,
  endAge: undefined,
  annualAmount: 2_434.8,
  growthRate: 0.055,
  recurrenceIntervalYears: 1,
}
