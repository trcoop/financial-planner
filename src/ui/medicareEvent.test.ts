import { describe, expect, it } from 'vitest'
import { MEDICARE_PART_B_EVENT } from './medicareEvent'

describe('MEDICARE_PART_B_EVENT', () => {
  it('matches the ERD §5 definition exactly', () => {
    expect(MEDICARE_PART_B_EVENT).toEqual({
      type: 'recurringCost',
      id: 'medicarePartB',
      label: 'Medicare Part B',
      startAge: 65,
      endAge: undefined,
      annualAmount: 2_434.8,
      growthRate: 0.055,
      recurrenceIntervalYears: 1,
    })
  })
})
