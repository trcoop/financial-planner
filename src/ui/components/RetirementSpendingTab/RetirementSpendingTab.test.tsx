import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlanAssumptions, ProjectionRow } from '../../../engine'
import * as knowYourNumberModule from '../../../engine/knowYourNumber'
import { RetirementSpendingTab } from './RetirementSpendingTab'
import { DEFAULT_RETIREMENT_SPENDING_VALUES, type RetirementSpendingValues } from './RetirementSpendingGoal'

// Spied (not mocked) so the real calculation still runs — this only lets a test assert whether
// it was called at all, distinguishing "no goal set, so no calculation was attempted" from
// "a calculation was attempted and happened to be caught/hidden" (mutation-testing finding: the
// `goalAnnualAmount !== undefined` gate's own tests didn't kill a mutant that removed the gate,
// because an ungated call with `desiredMonthlySpend: undefined / 12` throws NON_FINITE_INPUT and
// the component's catch block hides it identically — same rendered output, wrong reason).
const calculateKnowYourNumberSpy = vi.spyOn(knowYourNumberModule, 'calculateKnowYourNumber')

afterEach(() => cleanup())

/** currentAge === retirementAge collapses `knowYourNumber`'s accumulation loop to zero years,
 * so `projectedBalance` is simply `initialBalance` — deterministic reference numbers below rely
 * on this to avoid re-deriving compound-growth arithmetic in test fixtures. */
const BASE_ASSUMPTIONS: PlanAssumptions = {
  currentAge: 65,
  retirementAge: 65,
  initialBalance: 2_000_000,
  currentAnnualIncome: 0,
  annualContributionRate: 0,
  annualRaiseRate: 0,
  annualReturnRate: 0.068,
  inflationRate: 0.025,
  withdrawalRateInRetirement: 0.04,
  planningHorizonEndAge: 100,
}

const NO_ROWS: ProjectionRow[] = []

function renderTab(
  overrides: {
    values?: RetirementSpendingValues
    onChange?: ReturnType<typeof vi.fn<(values: RetirementSpendingValues) => void>>
    assumptions?: PlanAssumptions
    rows?: ProjectionRow[]
    hasSpouse?: boolean
  } = {},
) {
  const onChange = overrides.onChange ?? vi.fn()
  render(
    <RetirementSpendingTab
      values={overrides.values ?? DEFAULT_RETIREMENT_SPENDING_VALUES}
      onChange={onChange}
      assumptions={overrides.assumptions ?? BASE_ASSUMPTIONS}
      rows={overrides.rows ?? NO_ROWS}
      hasSpouse={overrides.hasSpouse ?? false}
    />,
  )
  return { onChange }
}

describe('RetirementSpendingTab — general spending goal (FIN-135)', () => {
  it('renders the general amount field and a monthly/annual frequency toggle', () => {
    renderTab()
    expect(screen.getByLabelText(/household spending goal/i)).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: /frequency/i })).toBeInTheDocument()
  })

  it('round-trips an annual entry as annual — $60,000 redisplays as $60,000, not a derived $5,000/mo (ERD §4 round-trip contract)', () => {
    renderTab({ values: { generalAmount: 60_000, generalAmountUnit: 'annual' } })
    const field = screen.getByLabelText(/household spending goal/i) as HTMLInputElement
    expect(field.value).toBe('$60,000')
    expect(within(screen.getByRole('radiogroup', { name: /frequency/i })).getByRole('radio', { name: 'Annual' })).toBeChecked()
  })

  it('round-trips a monthly entry as monthly', () => {
    renderTab({ values: { generalAmount: 5_000, generalAmountUnit: 'monthly' } })
    const field = screen.getByLabelText(/household spending goal/i) as HTMLInputElement
    expect(field.value).toBe('$5,000')
    expect(within(screen.getByRole('radiogroup', { name: /frequency/i })).getByRole('radio', { name: 'Monthly' })).toBeChecked()
  })

  it('calls onChange with the raw entered amount and the currently-selected unit when the amount is edited', async () => {
    const user = userEvent.setup()
    const { onChange } = renderTab({ values: { generalAmount: 0, generalAmountUnit: 'monthly' } })

    const field = screen.getByLabelText(/household spending goal/i)
    await user.clear(field)
    await user.type(field, '4500')

    const lastCall = onChange.mock.calls.at(-1)?.[0] as RetirementSpendingValues
    expect(lastCall.generalAmount).toBe(4500)
    expect(lastCall.generalAmountUnit).toBe('monthly')
  })

  it('converts the displayed amount when the frequency toggle is switched, preserving the real spending goal', async () => {
    const user = userEvent.setup()
    const { onChange } = renderTab({ values: { generalAmount: 5_000, generalAmountUnit: 'monthly' } })

    await user.click(within(screen.getByRole('radiogroup', { name: /frequency/i })).getByRole('radio', { name: 'Annual' }))

    const lastCall = onChange.mock.calls.at(-1)?.[0] as RetirementSpendingValues
    expect(lastCall.generalAmountUnit).toBe('annual')
    expect(lastCall.generalAmount).toBe(60_000)
  })
})

describe('RetirementSpendingTab — no duplicated rate inputs (AC)', () => {
  it('does not render inflation rate, return rate, or life expectancy inputs — those live on the Rates tab', () => {
    renderTab()
    expect(screen.queryByLabelText(/inflation/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/return/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/life expectancy/i)).not.toBeInTheDocument()
  })
})

describe('RetirementSpendingTab — Medicare lines', () => {
  it('always shows the primary Medicare Part B field, prefilled with the suggested default', () => {
    renderTab({ hasSpouse: false })
    const field = screen.getByLabelText(/medicare part b/i) as HTMLInputElement
    expect(field).toBeInTheDocument()
    expect(field.value).toBe('$2,434.8')
  })

  it('omits the spouse Medicare field entirely when there is no spouse (not disabled — absent)', () => {
    renderTab({ hasSpouse: false })
    expect(screen.queryByLabelText(/spouse.*medicare/i)).not.toBeInTheDocument()
  })

  it('shows the spouse Medicare field, prefilled with the same suggested default, when a spouse exists', () => {
    renderTab({ hasSpouse: true })
    const field = screen.getByLabelText(/spouse.*medicare/i) as HTMLInputElement
    expect(field.value).toBe('$2,434.8')
  })

  it('calls onChange with an explicit override when the primary Medicare field is edited', async () => {
    const user = userEvent.setup()
    const { onChange } = renderTab()

    const field = screen.getByLabelText(/^medicare part b/i)
    await user.clear(field)
    await user.type(field, '3000')

    const lastCall = onChange.mock.calls.at(-1)?.[0] as RetirementSpendingValues
    expect(lastCall.primaryMedicareAnnualAmount).toBe(3000)
  })
})

describe('RetirementSpendingTab — on-track readout (shared knowYourNumber module)', () => {
  it('shows a placeholder, not a readout, when no goal is set — and never even calls calculateKnowYourNumber', () => {
    calculateKnowYourNumberSpy.mockClear()
    renderTab({ values: DEFAULT_RETIREMENT_SPENDING_VALUES })
    expect(screen.getByText(/set a spending goal/i)).toBeInTheDocument()
    expect(calculateKnowYourNumberSpy).not.toHaveBeenCalled()
  })

  it('reports on track when the projected balance covers the target (goal well within reach)', () => {
    // desiredMonthlySpend $4,000 -> targetBalance = 4,000*12/0.04 = 1,200,000 <= 2,000,000 balance.
    renderTab({ values: { generalAmount: 4_000, generalAmountUnit: 'monthly' } })
    expect(screen.getByText(/on track/i)).toBeInTheDocument()
    expect(screen.getByText('$1,200,000')).toBeInTheDocument()
  })

  it('reports a shortfall amount when the projected balance falls short of the target', () => {
    // desiredMonthlySpend $10,000 -> targetBalance = 10,000*12/0.04 = 3,000,000 > 2,000,000 balance.
    // shortfallAmount = 3,000,000 - 2,000,000 = 1,000,000.
    renderTab({ values: { generalAmount: 10_000, generalAmountUnit: 'monthly' } })
    expect(screen.getByText('Short by $1,000,000')).toBeInTheDocument()
  })

  it('reports an earlier possible retirement age when accumulation gets there before the requested age', () => {
    const assumptions: PlanAssumptions = {
      ...BASE_ASSUMPTIONS,
      currentAge: 40,
      retirementAge: 65,
      initialBalance: 3_000_000,
      annualReturnRate: 0.068,
    }
    // desiredMonthlySpend $1,000 -> targetBalance = 1,000*12/0.04 = 300,000, already well below
    // the $3,000,000 starting balance at age 40 — on track at the requested age already, so this
    // exercises the "onTrack" (not couldRetireEarlier) short-circuit instead; see the dedicated
    // couldRetireEarlier-shaped fixture below for that branch.
    renderTab({ values: { generalAmount: 1_000, generalAmountUnit: 'monthly' }, assumptions })
    expect(screen.getByText(/on track/i)).toBeInTheDocument()
  })

  it('does not crash and falls back to the placeholder for a malformed plan (retirementAge before currentAge)', () => {
    const assumptions: PlanAssumptions = { ...BASE_ASSUMPTIONS, currentAge: 70, retirementAge: 65 }
    renderTab({ values: { generalAmount: 4_000, generalAmountUnit: 'monthly' }, assumptions })
    expect(screen.getByText("Set a spending goal above to see whether you're on track.")).toBeInTheDocument()
    expect(screen.queryByText('Your number')).not.toBeInTheDocument()
    expect(screen.queryByText(/short by/i)).not.toBeInTheDocument()
  })
})

describe('RetirementSpendingTab — plan depleted callout (ERD §5/§11, inline derivation)', () => {
  it('shows nothing when the plan never depletes', () => {
    const rows: ProjectionRow[] = [
      { age: 65, year: 0, beginningBalance: 100, annualContribution: 0, investmentReturn: 5, annualWithdrawal: 4, endingBalance: 101, eventCosts: [] },
    ]
    renderTab({ rows })
    expect(screen.queryByText(/depleted/i)).not.toBeInTheDocument()
  })

  it('shows "Plan depleted at age X" for the first zeroed row at/after retirement age', () => {
    const rows: ProjectionRow[] = [
      { age: 65, year: 0, beginningBalance: 100, annualContribution: 0, investmentReturn: 5, annualWithdrawal: 4, endingBalance: 50, eventCosts: [] },
      { age: 66, year: 1, beginningBalance: 50, annualContribution: 0, investmentReturn: 0, annualWithdrawal: 50, endingBalance: 0, eventCosts: [] },
      { age: 67, year: 2, beginningBalance: 0, annualContribution: 0, investmentReturn: 0, annualWithdrawal: 0, endingBalance: 0, eventCosts: [] },
    ]
    renderTab({ rows })
    expect(screen.getByText(/plan depleted at age 66/i)).toBeInTheDocument()
  })

  it('ignores a pre-retirement zero balance (defensive age >= retirementAge guard)', () => {
    const assumptions: PlanAssumptions = { ...BASE_ASSUMPTIONS, currentAge: 30, retirementAge: 65 }
    const rows: ProjectionRow[] = [
      { age: 30, year: 0, beginningBalance: 0, annualContribution: 0, investmentReturn: 0, annualWithdrawal: 0, endingBalance: 0, eventCosts: [] },
      { age: 65, year: 35, beginningBalance: 500, annualContribution: 0, investmentReturn: 0, annualWithdrawal: 100, endingBalance: 400, eventCosts: [] },
    ]
    renderTab({ assumptions, rows })
    expect(screen.queryByText(/depleted/i)).not.toBeInTheDocument()
  })
})
