import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RetirementNumberCalculator } from './RetirementNumberCalculator'
import { saveAssumptions, STORAGE_KEY } from '../../../storage'
import { DEFAULT_CORE_VALUES } from '../../coreInputs/defaults'
import { DEFAULT_ADVANCED_VALUES } from '../AdvancedAssumptionsForm/defaults'
import { createAccount } from '../AccountsTab/Account'
import type { Person } from '../PeopleTab/Person'

async function openAdvanced(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText('Advanced assumptions'))
}

async function setField(user: ReturnType<typeof userEvent.setup>, label: string | RegExp, value: string) {
  const field = screen.getByLabelText(label)
  await user.clear(field)
  if (value !== '') await user.type(field, value)
}

async function fillRequiredFields(
  user: ReturnType<typeof userEvent.setup>,
  values: {
    currentAge: string
    retirementAge: string
    desiredMonthlySpend: string
    currentBalance: string
    annualContribution: string
  },
) {
  await setField(user, /current age/i, values.currentAge)
  await setField(user, /target retirement age/i, values.retirementAge)
  await setField(user, /desired monthly retirement spend/i, values.desiredMonthlySpend)
  await setField(user, /current retirement account balance/i, values.currentBalance)
  await setField(user, /annual investment\/contribution amount/i, values.annualContribution)
}

describe('RetirementNumberCalculator', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('shows no result and marks every required field on first open', () => {
    render(<RetirementNumberCalculator />)

    expect(screen.queryByText(/on track/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/short by/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/could retire/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Your number')).not.toBeInTheDocument()

    expect(screen.getByLabelText(/current age/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/target retirement age/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/desired monthly retirement spend/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/current retirement account balance/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/annual investment\/contribution amount/i)).toBeInTheDocument()

    // Every required field starts genuinely blank (not prefilled with a default number) — the
    // NumberField's own contract is that a non-finite value renders as empty text.
    expect(screen.getByLabelText(/current age/i)).toHaveValue('')
    expect(screen.getByLabelText(/target retirement age/i)).toHaveValue('')
  })

  it('shows a validation error per required field and no result when Calculate is clicked blank', async () => {
    const user = userEvent.setup()
    render(<RetirementNumberCalculator />)

    await user.click(screen.getByRole('button', { name: 'Calculate' }))

    const alerts = screen.getAllByRole('alert')
    expect(alerts.length).toBeGreaterThanOrEqual(5)
    expect(screen.getByLabelText(/current age/i)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText(/target retirement age/i)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText(/desired monthly retirement spend/i)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText(/current retirement account balance/i)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText(/annual investment\/contribution amount/i)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByText('Your number')).not.toBeInTheDocument()
  })

  it('clears a required-field error live once that field is filled in, without another Calculate click', async () => {
    const user = userEvent.setup()
    render(<RetirementNumberCalculator />)

    await user.click(screen.getByRole('button', { name: 'Calculate' }))
    expect(screen.getByLabelText(/current age/i)).toHaveAttribute('aria-invalid', 'true')

    await user.type(screen.getByLabelText(/current age/i), '40')

    expect(screen.getByLabelText(/current age/i)).not.toHaveAttribute('aria-invalid', 'true')
  })

  it('shows "On track" with no probability/percentage when projected balance covers the target', async () => {
    const user = userEvent.setup()
    render(<RetirementNumberCalculator />)

    await fillRequiredFields(user, {
      currentAge: '30',
      retirementAge: '65',
      desiredMonthlySpend: '1000',
      currentBalance: '2000000',
      annualContribution: '10000',
    })
    await user.click(screen.getByRole('button', { name: 'Calculate' }))

    expect(screen.getByText(/on track/i)).toBeInTheDocument()
    expect(screen.queryByText(/short by/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/could retire/i)).not.toBeInTheDocument()
    expect(screen.queryByText('%')).not.toBeInTheDocument()
  })

  it('shows "short by $X" at the requested age when no age in range is on-track (already-retired edge case)', async () => {
    const user = userEvent.setup()
    render(<RetirementNumberCalculator />)

    await fillRequiredFields(user, {
      currentAge: '65',
      retirementAge: '65',
      desiredMonthlySpend: '5000',
      currentBalance: '10000',
      annualContribution: '0',
    })
    await openAdvanced(user)
    await setField(user, /life expectancy/i, '65')

    await user.click(screen.getByRole('button', { name: 'Calculate' }))

    // targetBalance = (5000 * 12) / 0.04 = 1,500,000; projectedBalance = 10,000 (0 accumulation
    // years, already retired) -> shortfall = 1,490,000, at the originally-requested age (65), not
    // a false "could retire at" (search range is the single age 65, which already failed).
    expect(screen.getByText(/short by/i)).toBeInTheDocument()
    expect(screen.getByText(/\$1,490,000/)).toBeInTheDocument()
    expect(screen.queryByText(/on track/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/could retire/i)).not.toBeInTheDocument()
  })

  it('shows "could retire at age Y" when an earlier age is on-track but the requested age is not', async () => {
    const user = userEvent.setup()
    render(<RetirementNumberCalculator />)

    await fillRequiredFields(user, {
      currentAge: '60',
      retirementAge: '70',
      desiredMonthlySpend: '2000',
      currentBalance: '1000000',
      annualContribution: '0',
    })
    await openAdvanced(user)
    await setField(user, /expected annual return/i, '-10')

    await user.click(screen.getByRole('button', { name: 'Calculate' }))

    // targetBalance = (2000*12)/0.04 = 600,000. At the requested age 70, a -10%/yr return for 10
    // years erodes $1,000,000 to ~$348,678 (< target) -> not on track. At age 60 (0 years erosion)
    // balance is still the full $1,000,000 (>= target) -> the earliest passing age is 60, before
    // the requested 70, so this is "could retire at age 60", not "short by".
    expect(screen.getByText(/could retire at age 60/i)).toBeInTheDocument()
    expect(screen.queryByText(/short by/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^on track$/i)).not.toBeInTheDocument()
  })

  it('hides "Pull from my plan" when no plan has ever been saved', () => {
    render(<RetirementNumberCalculator />)

    expect(screen.queryByRole('button', { name: /pull from my plan/i })).not.toBeInTheDocument()
  })

  it('"Pull from my plan" prefills age/retirement age/balance/life expectancy from the saved plan, stays editable, and never writes back to storage', async () => {
    const user = userEvent.setup()
    const primary: Person = {
      id: 'primary',
      name: 'You',
      age: 42,
      retirementAge: 67,
      salary: 120_000,
      isPrimary: true,
    }
    const account1 = { ...createAccount('primary'), balance: 150_000 }
    const account2 = { ...createAccount('primary'), balance: 25_000 }
    saveAssumptions(DEFAULT_CORE_VALUES, DEFAULT_ADVANCED_VALUES, [primary], [account1, account2])
    const persistedBefore = localStorage.getItem(STORAGE_KEY)

    render(<RetirementNumberCalculator />)

    await user.click(screen.getByRole('button', { name: /pull from my plan/i }))

    expect(screen.getByLabelText(/current age/i)).toHaveValue('42')
    expect(screen.getByLabelText(/target retirement age/i)).toHaveValue('67')
    // Sum of both accounts (mirrors PlanSection's totalAccountBalance pattern).
    expect(screen.getByLabelText(/current retirement account balance/i)).toHaveValue('$175,000')

    await openAdvanced(user)
    expect(screen.getByLabelText(/life expectancy/i)).toHaveValue('100')

    // Still editable after the pull — not a live/locked binding.
    await setField(user, /current age/i, '50')
    expect(screen.getByLabelText(/current age/i)).toHaveValue('50')

    // Read-only: pulling never writes anything back to storage.
    expect(localStorage.getItem(STORAGE_KEY)).toEqual(persistedBefore)
  })

  it('"Pull from my plan" clears the pulled fields\' required-blank state, so Calculate works immediately without re-touching them', async () => {
    const user = userEvent.setup()
    const primary: Person = {
      id: 'primary',
      name: 'You',
      age: 42,
      retirementAge: 67,
      salary: 120_000,
      isPrimary: true,
    }
    saveAssumptions(DEFAULT_CORE_VALUES, DEFAULT_ADVANCED_VALUES, [primary], [
      { ...createAccount('primary'), balance: 150_000 },
    ])

    render(<RetirementNumberCalculator />)
    await user.click(screen.getByRole('button', { name: /pull from my plan/i }))
    // Only the two fields the plan has no equivalent for still need to be filled in.
    await setField(user, /desired monthly retirement spend/i, '1000')
    await setField(user, /annual investment\/contribution amount/i, '5000')
    await user.click(screen.getByRole('button', { name: 'Calculate' }))

    // No stale "Enter your current age."/"Enter your target retirement age." errors, even
    // though those two fields were never directly typed into by the user (only pulled).
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/current age/i)).not.toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText(/target retirement age/i)).not.toHaveAttribute('aria-invalid', 'true')
  })
})
