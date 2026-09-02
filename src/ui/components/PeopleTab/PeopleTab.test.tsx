import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { PeopleTab } from './PeopleTab'
import { createPrimaryPerson, createSpouse, type Person } from './Person'
import { DEFAULT_CORE_VALUES } from '../CoreInputsForm/defaults'

const PRIMARY = createPrimaryPerson(DEFAULT_CORE_VALUES)

function ControlledPeopleTab({ initial }: { initial: Person[] }) {
  const [people, setPeople] = useState(initial)
  return <PeopleTab people={people} onChange={setPeople} />
}

describe('PeopleTab', () => {
  afterEach(() => cleanup())

  it('renders the primary person with name/age/retirement age/salary fields', () => {
    render(<PeopleTab people={[PRIMARY]} onChange={vi.fn()} />)
    expect(screen.getByLabelText('Name')).toHaveValue(PRIMARY.name)
    expect(screen.getByLabelText('Current age')).toHaveValue(String(PRIMARY.age))
    expect(screen.getByLabelText('Retirement age')).toHaveValue(String(PRIMARY.retirementAge))
    expect(screen.getByLabelText('Salary')).toHaveValue(`$${PRIMARY.salary.toLocaleString()}`)
  })

  it('does not render a contribution field', () => {
    render(<PeopleTab people={[PRIMARY]} onChange={vi.fn()} />)
    expect(screen.queryByLabelText(/contribution/i)).not.toBeInTheDocument()
  })

  it('renders a "+ Spouse" button when there is only a primary person', () => {
    render(<PeopleTab people={[PRIMARY]} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: '+ Spouse' })).toBeInTheDocument()
  })

  it('hides the "+ Spouse" button once a non-primary person exists', () => {
    const spouse = createSpouse()
    render(<PeopleTab people={[PRIMARY, spouse]} onChange={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '+ Spouse' })).not.toBeInTheDocument()
  })

  it('clicking "+ Spouse" adds a second, non-primary Person', () => {
    const onChange = vi.fn()
    render(<PeopleTab people={[PRIMARY]} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: '+ Spouse' }))

    expect(onChange).toHaveBeenCalledTimes(1)
    const updated = onChange.mock.calls[0][0] as Person[]
    expect(updated).toHaveLength(2)
    expect(updated[0]).toEqual(PRIMARY)
    expect(updated[1].isPrimary).toBe(false)
  })

  it('does not render a delete/remove control for the primary person', () => {
    render(<PeopleTab people={[PRIMARY]} onChange={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument()
  })

  it('renders a remove control for a non-primary (spouse) person', () => {
    const spouse = createSpouse()
    render(<PeopleTab people={[PRIMARY, spouse]} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: /remove spouse/i })).toBeInTheDocument()
  })

  it('removing the spouse (who has no accounts) deletes them directly with no dialog', () => {
    const spouse = createSpouse()
    const onChange = vi.fn()
    render(<PeopleTab people={[PRIMARY, spouse]} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /remove spouse/i }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onChange).toHaveBeenCalledWith([PRIMARY])
  })

  it('removing the spouse who owns an account shows the cascade-delete warning dialog instead of deleting immediately', () => {
    const spouse = createSpouse()
    const onChange = vi.fn()
    render(<PeopleTab people={[PRIMARY, spouse]} onChange={onChange} accounts={[{ ownerId: spouse.id }]} />)

    fireEvent.click(screen.getByRole('button', { name: /remove spouse/i }))

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('confirming the cascade-delete dialog removes the spouse', () => {
    const spouse = createSpouse()
    const onChange = vi.fn()
    render(<PeopleTab people={[PRIMARY, spouse]} onChange={onChange} accounts={[{ ownerId: spouse.id }]} />)

    fireEvent.click(screen.getByRole('button', { name: /remove spouse/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

    expect(onChange).toHaveBeenCalledWith([PRIMARY])
  })

  it('does not show the cascade-delete dialog for a spouse whose accounts belong to someone else', () => {
    const spouse = createSpouse()
    const onChange = vi.fn()
    render(<PeopleTab people={[PRIMARY, spouse]} onChange={onChange} accounts={[{ ownerId: PRIMARY.id }]} />)

    fireEvent.click(screen.getByRole('button', { name: /remove spouse/i }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onChange).toHaveBeenCalledWith([PRIMARY])
  })

  it('editing a field for the correct person preserves the other person untouched', () => {
    const spouse = createSpouse()
    const onChange = vi.fn()
    render(<PeopleTab people={[PRIMARY, spouse]} onChange={onChange} />)

    const ageInputs = screen.getAllByLabelText('Current age')
    fireEvent.change(ageInputs[1], { target: { value: '50' } })

    expect(onChange).toHaveBeenLastCalledWith([PRIMARY, { ...spouse, age: 50 }])
  })

  it('shows a validation error for an out-of-range age', () => {
    const outOfRange = { ...PRIMARY, age: 150 }
    render(<PeopleTab people={[outOfRange]} onChange={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/between 18 and 100/i)
  })

  it('round-trips a name edit through the controlled state', () => {
    render(<ControlledPeopleTab initial={[PRIMARY]} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Travis' } })
    expect(screen.getByLabelText('Name')).toHaveValue('Travis')
  })
})
