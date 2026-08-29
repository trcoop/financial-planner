import type { PlanEvent } from '../engine'
import { HISTORICAL_ANNUAL_INFLATION } from '../engine/inflationData'
import { HISTORICAL_ANNUAL_MEDICAL_INFLATION } from '../engine/medicalInflationData'

type MedicarePartBEvent = Extract<PlanEvent, { type: 'recurringCost' }>

/**
 * `mean(medicalInflation[y] - inflation[y])` across every year both `HISTORICAL_ANNUAL_MEDICAL_
 * INFLATION` and `HISTORICAL_ANNUAL_INFLATION` cover (the full 1936-2025 overlap — the medical
 * series' backfilled 1928-1935 years are excluded since they're derived FROM the general series
 * at a fixed ratio, not an independent observation).
 *
 * Deliberately the full-history window, not a shorter trailing one (FIN-77): trailing windows
 * are unstable and sometimes inverted (the trailing 5 years alone give a *negative* spread, a
 * COVID-era artifact of general CPI briefly outrunning administratively-stickier medical CPI),
 * while every 5-year bucket from 1996-2020 sits consistently in a +0.9 to +1.8pp band. Computed
 * from the arrays at call time (not a frozen literal) specifically so it keeps tracking reality
 * once FIN-76 starts appending new confirmed years to those datasets — no separate manual step
 * to also update a rate constant.
 */
/** First year with a REAL (non-backfilled) BLS medical-care CPI-U observation — see
 * `medicalInflationData.ts`'s header. Years before this are backfilled from the general series
 * at a fixed ratio, so including them here would compare the general series against a number
 * partly derived FROM itself, silently inflating (or deflating) the computed spread. */
const FIRST_REAL_MEDICAL_INFLATION_YEAR = 1936

export function medicalInflationSpread(): number {
  const generalInflationByYear = new Map(HISTORICAL_ANNUAL_INFLATION.map((entry) => [entry.year, entry.inflation]))

  const overlapDiffs = HISTORICAL_ANNUAL_MEDICAL_INFLATION.filter(
    (entry) => entry.year >= FIRST_REAL_MEDICAL_INFLATION_YEAR && generalInflationByYear.has(entry.year),
  ).map((entry) => entry.medicalInflation - (generalInflationByYear.get(entry.year) as number))

  return overlapDiffs.reduce((sum, diff) => sum + diff, 0) / overlapDiffs.length
}

/**
 * The Medicare Part B event's static fields — everything but `growthRate`, which depends on the
 * plan's own inflation assumption and is filled in by {@link medicarePartBEvent}. Wired
 * unconditionally into every plan (Events & Medicare Cost PRD's "no opt-in/opt-out" requirement;
 * ERD §5). Starts at age 65 regardless of the plan's retirement age, runs through the plan
 * horizon (`endAge: undefined`), recurs annually.
 *
 * `annualAmount`: CMS's CY2026 standard Part B monthly premium is $202.90 ($2,434.80/yr), a
 * $17.90/mo increase from 2025's $185.00, per the CMS CY2026 Medicare Deductible, Coinsurance
 * & Premium Rates update (Federal Register, Nov 2025) — the *standard* premium (pre-IRMAA),
 * consistent with the PRD's IRMAA non-goal.
 *
 * The engine has no knowledge that this event is "Medicare" — it just runs whatever `events`
 * array it's given (ERD §5). This constant (plus {@link medicarePartBEvent}) is the UI-side
 * call-site wiring that makes it so.
 */
export const MEDICARE_PART_B_EVENT: Omit<MedicarePartBEvent, 'growthRate'> = {
  type: 'recurringCost',
  id: 'medicarePartB',
  label: 'Medicare Part B',
  startAge: 65,
  endAge: undefined,
  annualAmount: 2_434.8,
  recurrenceIntervalYears: 1,
}

/**
 * Builds the Medicare Part B event for the deterministic/GBM projection branch, given the
 * plan's own general inflation assumption.
 *
 * `growthRate`: `generalInflationRate + medicalInflationSpread()` (FIN-77) — replaces a
 * previous flat 5.5% that was sourced from an external secondary citation (Peterson-KFF Health
 * System Tracker's "since-1948, ~5.3%" figure) which didn't reproduce from our own primary
 * BLS-sourced data, and which was also decoupled from whatever general inflation rate a given
 * plan assumes. This ties Medicare cost growth to the SAME plan's inflation assumption plus a
 * historically-observed excess-over-inflation spread, so it stays sensible across different
 * inflation assumptions instead of only "working" near ~3.5%.
 *
 * This is the deterministic/GBM-branch rate — Monte Carlo's historical branch instead samples
 * `HISTORICAL_ANNUAL_MEDICAL_INFLATION` per period (FIN-72/WP-2) and is unaffected by this
 * function; it only ever sees this rate as that branch's own gap-year fallback (a year outside
 * the historical table), by the same `eventGrowthOverrides?.get(id) ?? event.growthRate`
 * mechanism the deterministic branch also uses (WP-1b, `pipeline.ts`).
 */
export function medicarePartBEvent(generalInflationRate: number): MedicarePartBEvent {
  return {
    ...MEDICARE_PART_B_EVENT,
    growthRate: generalInflationRate + medicalInflationSpread(),
  }
}
