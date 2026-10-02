import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { PeopleTab } from './PeopleTab'
import { createPrimaryPerson, createSpouse, type Person } from './Person'
import { DEFAULT_CORE_VALUES } from '../../coreInputs/defaults'
import { TEST_ASOF } from '../../../testAsOf'
import { FrozenAsOfProvider } from '../../AsOfContext'

const PRIMARY = createPrimaryPerson(DEFAULT_CORE_VALUES, TEST_ASOF)

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
    const spouse = createSpouse(TEST_ASOF)
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
    const spouse = createSpouse(TEST_ASOF)
    render(<PeopleTab people={[PRIMARY, spouse]} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: /remove spouse/i })).toBeInTheDocument()
  })

  it('removing the spouse (who has no accounts) deletes them directly with no dialog', () => {
    const spouse = createSpouse(TEST_ASOF)
    const onChange = vi.fn()
    render(<PeopleTab people={[PRIMARY, spouse]} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /remove spouse/i }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onChange).toHaveBeenCalledWith([PRIMARY])
  })

  it('removing the spouse who owns an account shows the cascade-delete warning dialog instead of deleting immediately', () => {
    const spouse = createSpouse(TEST_ASOF)
    const onChange = vi.fn()
    render(<PeopleTab people={[PRIMARY, spouse]} onChange={onChange} accounts={[{ ownerId: spouse.id }]} />)

    fireEvent.click(screen.getByRole('button', { name: /remove spouse/i }))

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('confirming the cascade-delete dialog removes the spouse', () => {
    const spouse = createSpouse(TEST_ASOF)
    const onChange = vi.fn()
    render(<PeopleTab people={[PRIMARY, spouse]} onChange={onChange} accounts={[{ ownerId: spouse.id }]} />)

    fireEvent.click(screen.getByRole('button', { name: /remove spouse/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

    expect(onChange).toHaveBeenCalledWith([PRIMARY])
  })

  it('does not show the cascade-delete dialog for a spouse whose accounts belong to someone else', () => {
    const spouse = createSpouse(TEST_ASOF)
    const onChange = vi.fn()
    render(<PeopleTab people={[PRIMARY, spouse]} onChange={onChange} accounts={[{ ownerId: PRIMARY.id }]} />)

    fireEvent.click(screen.getByRole('button', { name: /remove spouse/i }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onChange).toHaveBeenCalledWith([PRIMARY])
  })

  it('editing a field for the correct person preserves the other person untouched', () => {
    const spouse = createSpouse(TEST_ASOF)
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

  describe('birth fields (FIN-162)', () => {
    const legacy: Person = { id: 'primary', name: 'You', age: 40, retirementAge: 65, salary: 1, isPrimary: true }
    const renderFrozen = (people: Person[]) =>
      render(
        <FrozenAsOfProvider asOf={TEST_ASOF}>
          <PeopleTab people={people} onChange={vi.fn()} />
        </FrozenAsOfProvider>,
      )

    it('a person with no birth month/year shows a required error on each field', () => {
      renderFrozen([legacy])
      expect(screen.getByLabelText('Birth month')).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByLabelText('Birth year')).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByText('Birth month is required (1-12).')).toBeInTheDocument()
      expect(screen.getByText('Birth year is required.')).toBeInTheDocument()
    })

    it('a person with valid birth shows no birth error and the stored values', () => {
      renderFrozen([{ ...legacy, birthMonth: 4, birthYear: 1986 }])
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.getByLabelText('Birth month')).toHaveValue('4')
      expect(screen.getByLabelText('Birth year')).toHaveValue('1,986')
    })

    it('an out-of-range birth year shows the range error', () => {
      renderFrozen([{ ...legacy, birthMonth: 4, birthYear: 1500 }])
      expect(screen.getByText('Birth year must be between 1926 and 2008.')).toBeInTheDocument()
    })

    it('editing birth year writes birthYear and keeps age in step', () => {
      const onChange = vi.fn()
      render(
        <FrozenAsOfProvider asOf={TEST_ASOF}>
          <PeopleTab people={[{ ...legacy, birthMonth: 4, birthYear: 1986 }]} onChange={onChange} />
        </FrozenAsOfProvider>,
      )
      fireEvent.change(screen.getByLabelText('Birth year'), { target: { value: '1990' } })
      expect(onChange).toHaveBeenLastCalledWith([{ ...legacy, birthMonth: 4, birthYear: 1990, age: 36 }])
    })
  })
})
