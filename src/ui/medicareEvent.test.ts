import { describe, expect, it } from 'vitest'
import { HISTORICAL_ANNUAL_INFLATION } from '../engine/inflationData'
import { HISTORICAL_ANNUAL_MEDICAL_INFLATION } from '../engine/medicalInflationData'
import {
  MEDICARE_PART_B_EVENT,
  medicalInflationSpread,
  medicarePartBEvent,
  spouseMedicarePartBEvent,
} from './medicareEvent'

describe('MEDICARE_PART_B_EVENT', () => {
  it('matches the ERD §5 definition exactly, minus growthRate (now computed per plan)', () => {
    expect(MEDICARE_PART_B_EVENT).toEqual({
      type: 'recurringCost',
      id: 'medicarePartB',
      label: 'Medicare Part B',
      startAge: 65,
      endAge: undefined,
      annualAmount: 2_434.8,
      recurrenceIntervalYears: 1,
    })
  })
})

/** Mirrors `medicareEvent.ts`'s own `FIRST_REAL_MEDICAL_INFLATION_YEAR`: years before this are
 * backfilled into `HISTORICAL_ANNUAL_MEDICAL_INFLATION` from the general series at a fixed
 * ratio (see that file's header), so they're excluded from these expectations the same way the
 * production code excludes them — comparing the general series against a number partly derived
 * from itself would be circular. */
const FIRST_REAL_MEDICAL_INFLATION_YEAR = 1936

describe('medicalInflationSpread', () => {
  it('computes mean(medicalInflation[y] - inflation[y]) across the full 1936-2025 historical overlap', () => {
    const generalByYear = new Map(HISTORICAL_ANNUAL_INFLATION.map((entry) => [entry.year, entry.inflation]))
    const diffs = HISTORICAL_ANNUAL_MEDICAL_INFLATION.filter(
      (entry) => entry.year >= FIRST_REAL_MEDICAL_INFLATION_YEAR && generalByYear.has(entry.year),
    ).map((entry) => entry.medicalInflation - (generalByYear.get(entry.year) as number))
    const expected = diffs.reduce((sum, diff) => sum + diff, 0) / diffs.length

    expect(medicalInflationSpread()).toBeCloseTo(expected, 10)
  })

  it('excludes the pre-1936 backfilled medical-inflation years from the overlap', () => {
    const generalByYear = new Map(HISTORICAL_ANNUAL_INFLATION.map((entry) => [entry.year, entry.inflation]))
    const diffsIncludingBackfill = HISTORICAL_ANNUAL_MEDICAL_INFLATION.filter((entry) =>
      generalByYear.has(entry.year),
    ).map((entry) => entry.medicalInflation - (generalByYear.get(entry.year) as number))
    const meanIncludingBackfill =
      diffsIncludingBackfill.reduce((sum, diff) => sum + diff, 0) / diffsIncludingBackfill.length

    expect(medicalInflationSpread()).not.toBeCloseTo(meanIncludingBackfill, 3)
  })

  it('matches the ticket-cited full-history figure of about +1.01pp', () => {
    expect(medicalInflationSpread()).toBeCloseTo(0.0101, 3)
  })

  it('is computed from the arrays, not a frozen literal — recomputes if the overlap changes', () => {
    // A crude but meaningful check: dropping the most recent (COVID-era, negative-diff) years
    // from consideration should move the computed spread, proving it's not hardcoded.
    const generalByYear = new Map(HISTORICAL_ANNUAL_INFLATION.map((entry) => [entry.year, entry.inflation]))
    const trimmed = HISTORICAL_ANNUAL_MEDICAL_INFLATION.filter(
      (entry) =>
        entry.year >= FIRST_REAL_MEDICAL_INFLATION_YEAR && generalByYear.has(entry.year) && entry.year <= 2020,
    )
    const trimmedDiffs = trimmed.map(
      (entry) => entry.medicalInflation - (generalByYear.get(entry.year) as number),
    )
    const trimmedMean = trimmedDiffs.reduce((sum, diff) => sum + diff, 0) / trimmedDiffs.length

    expect(medicalInflationSpread()).not.toBeCloseTo(trimmedMean, 3)
  })
})

describe('medicarePartBEvent', () => {
  it('sets growthRate to the given general inflation rate plus the historical spread', () => {
    const event = medicarePartBEvent(0.03)

    expect(event.growthRate).toBeCloseTo(0.03 + medicalInflationSpread(), 10)
  })

  it('carries all the other static fields unchanged', () => {
    const event = medicarePartBEvent(0.025)

    expect(event).toMatchObject({
      type: 'recurringCost',
      id: 'medicarePartB',
      label: 'Medicare Part B',
      startAge: 65,
      endAge: undefined,
      annualAmount: 2_434.8,
      recurrenceIntervalYears: 1,
    })
  })

  it('tracks a different inflation assumption with a different growthRate', () => {
    const low = medicarePartBEvent(0.01)
    const high = medicarePartBEvent(0.05)

    expect(high.growthRate - low.growthRate).toBeCloseTo(0.04, 10)
  })
})

describe('spouseMedicarePartBEvent', () => {
  it('computes startAge as currentAge + (65 - spouseAge)', () => {
    const event = spouseMedicarePartBEvent(40, 38, 0.03)

    expect(event.startAge).toBe(67)
  })

  it('computes startAge equal to currentAge when spouse is also 65', () => {
    const event = spouseMedicarePartBEvent(70, 65, 0.03)

    expect(event.startAge).toBe(70)
  })

  it('computes a startAge earlier than currentAge when spouse is older', () => {
    const event = spouseMedicarePartBEvent(60, 65, 0.03)

    expect(event.startAge).toBe(60)
  })

  it('sets growthRate to the given general inflation rate plus the historical spread', () => {
    const event = spouseMedicarePartBEvent(40, 38, 0.03)

    expect(event.growthRate).toBeCloseTo(0.03 + medicalInflationSpread(), 10)
  })

  it('carries the other static fields matching the primary Medicare Part B event', () => {
    const event = spouseMedicarePartBEvent(40, 38, 0.025)

    expect(event).toMatchObject({
      type: 'recurringCost',
      id: 'medicareSpousePartB',
      label: "Spouse's Medicare Part B",
      endAge: undefined,
      annualAmount: 2_434.8,
      recurrenceIntervalYears: 1,
    })
  })

  it('tracks a different inflation assumption with a different growthRate', () => {
    const low = spouseMedicarePartBEvent(40, 38, 0.01)
    const high = spouseMedicarePartBEvent(40, 38, 0.05)

    expect(high.growthRate - low.growthRate).toBeCloseTo(0.04, 10)
  })
})
