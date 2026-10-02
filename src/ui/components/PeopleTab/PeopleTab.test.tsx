import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
    const renderFrozen = (people: Person[], onChange = vi.fn()) =>
      render(
        <FrozenAsOfProvider asOf={TEST_ASOF}>
          <PeopleTab people={people} onChange={onChange} />
        </FrozenAsOfProvider>,
      )

    it('a person with no birth shows "Month"/"Year" placeholders and required errors', () => {
      renderFrozen([legacy])
      expect(screen.getByLabelText('Birth month')).toHaveTextContent('Month')
      expect(screen.getByLabelText('Birth year')).toHaveTextContent('Year')
      expect(screen.getByLabelText('Birth month')).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByLabelText('Birth year')).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByText('Birth month is required.')).toBeInTheDocument()
      expect(screen.getByText('Birth year is required.')).toBeInTheDocument()
    })

    it('month list is placeholder then January..December', async () => {
      const user = userEvent.setup()
      renderFrozen([legacy])
      await user.click(screen.getByLabelText('Birth month'))
      const names = within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)
      expect(names).toEqual(['Month', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'])
    })

    it('year list is placeholder then asOf.year-18 down to asOf.year-100 (2008..1926)', async () => {
      const user = userEvent.setup()
      renderFrozen([legacy])
      await user.click(screen.getByLabelText('Birth year'))
      const names = within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)
      expect(names[0]).toBe('Year')
      expect(names[1]).toBe('2008')
      expect(names[names.length - 1]).toBe('1926')
      expect(names).toHaveLength(1 + 83)
    })

    it('a valid birth shows its month name and year with no alert', () => {
      renderFrozen([{ ...legacy, birthMonth: 4, birthYear: 1986 }])
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.getByLabelText('Birth month')).toHaveTextContent('April')
      expect(screen.getByLabelText('Birth year')).toHaveTextContent('1986')
    })

    it('a stored out-of-range year is kept as an extra selected option, with no range error', async () => {
      const user = userEvent.setup()
      renderFrozen([{ ...legacy, birthMonth: 4, birthYear: 1500 }])
      expect(screen.getByLabelText('Birth year')).toHaveTextContent('1500')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      await user.click(screen.getByLabelText('Birth year'))
      expect(within(screen.getByRole('listbox')).getByRole('option', { name: '1500' })).toBeInTheDocument()
    })

    it('choosing a year writes birthYear and keeps age in step', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      renderFrozen([{ ...legacy, birthMonth: 4, birthYear: 1986 }], onChange)
      await user.click(screen.getByLabelText('Birth year'))
      await user.click(screen.getByRole('option', { name: '1990' }))
      expect(onChange).toHaveBeenLastCalledWith([{ ...legacy, birthMonth: 4, birthYear: 1990, age: 36 }])
    })

    it('choosing a month writes birthMonth as a number and leaves age alone', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      renderFrozen([legacy], onChange)
      await user.click(screen.getByLabelText('Birth month'))
      await user.click(screen.getByRole('option', { name: 'March' }))
      expect(onChange).toHaveBeenLastCalledWith([{ ...legacy, birthMonth: 3 }])
    })

    it('choosing the placeholder clears that birth field to undefined and leaves age untouched', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      renderFrozen([{ ...legacy, birthMonth: 4, birthYear: 1986 }], onChange)
      await user.click(screen.getByLabelText('Birth year'))
      await user.click(screen.getByRole('option', { name: 'Year' }))
      const out = onChange.mock.calls.at(-1)![0][0]
      expect(out.birthYear).toBeUndefined()
      expect(out.age).toBe(40)
      expect(out.birthMonth).toBe(4)
    })

    it('choosing the "Month" placeholder sets birthMonth to undefined (not NaN, not 0) and leaves age alone', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      renderFrozen([{ ...legacy, birthMonth: 4, birthYear: 1986 }], onChange)
      await user.click(screen.getByLabelText('Birth month'))
      await user.click(screen.getByRole('option', { name: 'Month' }))
      const out = onChange.mock.calls.at(-1)![0][0]
      expect('birthMonth' in out).toBe(true)
      expect(out.birthMonth).toBeUndefined()
      expect(out.age).toBe(40)
      expect(out.birthYear).toBe(1986)
    })

    it.each([
      ['non-integer 1990.5', 1990.5, '1990.5'],
      ['above max 2020', 2020, '2020'],
    ])('a stored %s adds an extra selected option', async (_n, stored, label) => {
      const user = userEvent.setup()
      renderFrozen([{ ...legacy, birthMonth: 4, birthYear: stored }])
      expect(screen.getByLabelText('Birth year')).toHaveTextContent(label)
      await user.click(screen.getByLabelText('Birth year'))
      const names = within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)
      expect(names).toHaveLength(1 + 83 + 1)
      expect(names[names.length - 1]).toBe(label)
    })

    it('a stored NaN birthYear adds no extra option and shows the required error', async () => {
      const user = userEvent.setup()
      renderFrozen([{ ...legacy, birthMonth: 4, birthYear: NaN }])
      expect(screen.getByText('Birth year is required.')).toBeInTheDocument()
      await user.click(screen.getByLabelText('Birth year'))
      const names = within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)
      expect(names).toHaveLength(1 + 83)
      expect(names).not.toContain('NaN')
    })
  })
})
