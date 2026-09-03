import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RETIREMENT_SPENDING_VALUES,
  generalAmountError,
  medicareAmountError,
  retirementSpendingGoalAnnualAmount,
  type RetirementSpendingValues,
} from './RetirementSpendingGoal'

describe('DEFAULT_RETIREMENT_SPENDING_VALUES', () => {
  it('is an empty object — no goal set, no Medicare overrides', () => {
    expect(DEFAULT_RETIREMENT_SPENDING_VALUES).toEqual({})
  })
})

describe('retirementSpendingGoalAnnualAmount (FIN-135, ERD §4/§9 unit-conversion rule)', () => {
  it('returns undefined when generalAmount is undefined — no goal set', () => {
    expect(retirementSpendingGoalAnnualAmount({})).toBeUndefined()
  })

  it('returns undefined when generalAmount is explicitly 0, regardless of unit', () => {
    expect(retirementSpendingGoalAnnualAmount({ generalAmount: 0, generalAmountUnit: 'annual' })).toBeUndefined()
    expect(retirementSpendingGoalAnnualAmount({ generalAmount: 0, generalAmountUnit: 'monthly' })).toBeUndefined()
  })

  it('multiplies by 12 when the unit is monthly', () => {
    expect(retirementSpendingGoalAnnualAmount({ generalAmount: 5_000, generalAmountUnit: 'monthly' })).toBe(60_000)
  })

  it('passes the raw value through unchanged when the unit is annual (round-trip contract)', () => {
    // The round 2 review's exact example: an annual entry of $60,000 converts to $60,000
    // annual for the engine, NOT a derived $5,000/month figure re-multiplied.
    expect(retirementSpendingGoalAnnualAmount({ generalAmount: 60_000, generalAmountUnit: 'annual' })).toBe(60_000)
  })

  it('defaults to monthly when generalAmount is set but generalAmountUnit is somehow absent (defensive)', () => {
    expect(retirementSpendingGoalAnnualAmount({ generalAmount: 5_000 })).toBe(60_000)
  })
})

describe('generalAmountError', () => {
  it('has no error for a value within the monthly range', () => {
    expect(generalAmountError(5_000, 'monthly')).toBeUndefined()
  })

  it('errors for a negative value', () => {
    expect(generalAmountError(-1, 'monthly')).toBeDefined()
  })

  it('uses a wider range for annual than monthly (12x scale)', () => {
    // 1,500,000 is out of range monthly (max 1,000,000) but in range annual (max 12,000,000).
    expect(generalAmountError(1_500_000, 'monthly')).toBeDefined()
    expect(generalAmountError(1_500_000, 'annual')).toBeUndefined()
  })
})

describe('medicareAmountError', () => {
  it('has no error for a typical annual premium amount', () => {
    expect(medicareAmountError(2_434.8)).toBeUndefined()
  })

  it('errors for a negative value', () => {
    expect(medicareAmountError(-1)).toBeDefined()
  })
})

describe('RetirementSpendingValues shape (compile-time)', () => {
  it('accepts a fully-populated value', () => {
    const values: RetirementSpendingValues = {
      generalAmount: 5_000,
      generalAmountUnit: 'monthly',
      primaryMedicareAnnualAmount: 2_500,
      spouseMedicareAnnualAmount: 2_500,
    }
    expect(values.generalAmount).toBe(5_000)
  })
})
