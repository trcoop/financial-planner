import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountsTab } from './AccountsTab'
import { createAccount, type Account } from './Account'
import { createPrimaryPerson, createSpouse } from '../PeopleTab/Person'
import { DEFAULT_CORE_VALUES } from '../CoreInputsForm/defaults'

const PRIMARY = createPrimaryPerson(DEFAULT_CORE_VALUES)
const SPOUSE = createSpouse()
const PEOPLE = [PRIMARY, SPOUSE]

describe('AccountsTab', () => {
  afterEach(() => cleanup())

  it('shows an empty-state prompt when there are no accounts yet', () => {
    render(<AccountsTab accounts={[]} people={PEOPLE} onChange={vi.fn()} />)
    expect(screen.getByText(/add your first account/i)).toBeInTheDocument()
  })

  it('renders a "+ Account" button in the header', () => {
    render(<AccountsTab accounts={[]} people={PEOPLE} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: '+ Account' })).toBeInTheDocument()
  })

  it('clicking "+ Account" adds a new account owned by the first person', () => {
    const onChange = vi.fn()
    render(<AccountsTab accounts={[]} people={PEOPLE} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: '+ Account' }))

    expect(onChange).toHaveBeenCalledTimes(1)
    const updated = onChange.mock.calls[0][0] as Account[]
    expect(updated).toHaveLength(1)
    expect(updated[0].ownerId).toBe(PRIMARY.id)
  })

  it('renders each account with name/type/balance/contribution/owner fields', () => {
    const account = createAccount(PRIMARY.id)
    render(<AccountsTab accounts={[account]} people={PEOPLE} onChange={vi.fn()} />)

    expect(screen.getByLabelText('Account name')).toHaveValue(account.name)
    expect(screen.getByLabelText('Account type')).toBeInTheDocument()
    expect(screen.getByLabelText('Balance')).toHaveValue(`$${account.balance.toLocaleString()}`)
    expect(screen.getByLabelText('Owner')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Percentage' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Fixed Amount' })).not.toBeChecked()
    expect(screen.getByLabelText('Contribution %')).toBeInTheDocument()
  })

  it('swaps the contribution field when the Fixed Amount toggle is selected, keeping only the active value', () => {
    const account = { ...createAccount(PRIMARY.id), contributionValue: 10 }
    const onChange = vi.fn()
    render(<AccountsTab accounts={[account]} people={PEOPLE} onChange={onChange} />)

    fireEvent.click(screen.getByRole('radio', { name: 'Fixed Amount' }))

    expect(onChange).toHaveBeenCalledWith([{ ...account, contributionMode: 'fixed' }])
  })

  it('shows the Contribution $ field once in fixed mode', () => {
    const account = { ...createAccount(PRIMARY.id), contributionMode: 'fixed' as const, contributionValue: 500 }
    render(<AccountsTab accounts={[account]} people={PEOPLE} onChange={vi.fn()} />)
    expect(screen.getByLabelText('Contribution $')).toHaveValue('$500')
    expect(screen.queryByLabelText('Contribution %')).not.toBeInTheDocument()
  })

  it('owner dropdown lists all current people', () => {
    const account = createAccount(PRIMARY.id)
    render(<AccountsTab accounts={[account]} people={PEOPLE} onChange={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Owner'))
    expect(screen.getByRole('option', { name: 'You' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Spouse' })).toBeInTheDocument()
  })

  it('editing the balance updates only that account', () => {
    const accountA = createAccount(PRIMARY.id)
    const accountB = createAccount(SPOUSE.id)
    const onChange = vi.fn()
    render(<AccountsTab accounts={[accountA, accountB]} people={PEOPLE} onChange={onChange} />)

    const balanceInputs = screen.getAllByLabelText('Balance')
    fireEvent.change(balanceInputs[0], { target: { value: '1000' } })

    expect(onChange).toHaveBeenLastCalledWith([{ ...accountA, balance: 1000 }, accountB])
  })

  it('validates contribution percentage is within 0-100', () => {
    const account = { ...createAccount(PRIMARY.id), contributionValue: 150 }
    render(<AccountsTab accounts={[account]} people={PEOPLE} onChange={vi.fn()} />)

    expect(screen.getByRole('alert')).toHaveTextContent(/between 0 and 100/i)
  })

  it('shows a confirmation dialog before deleting an account, and only deletes on confirm', () => {
    const account = createAccount(PRIMARY.id)
    const onChange = vi.fn()
    render(<AccountsTab accounts={[account]} people={PEOPLE} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /delete/i }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('cancelling the delete confirmation keeps the account', () => {
    const account = createAccount(PRIMARY.id)
    const onChange = vi.fn()
    render(<AccountsTab accounts={[account]} people={PEOPLE} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /delete/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Account name')).toBeInTheDocument()
  })
})
