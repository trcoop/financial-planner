import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { CoreInputsForm, type CoreInputValues } from './CoreInputsForm'

const DEFAULT_VALUES: CoreInputValues = {
  currentAge: 35,
  retirementAge: 67,
  initialBalance: 250000,
  currentAnnualIncome: 85000,
  annualContributionRatePercent: 15,
}

function ControlledForm({ initial = DEFAULT_VALUES }: { initial?: CoreInputValues }) {
  const [values, setValues] = useState(initial)
  return <CoreInputsForm values={values} onChange={setValues} />
}

describe('CoreInputsForm', () => {
  afterEach(() => cleanup())

  it('renders the 5 core inputs in order with clear labels', () => {
    render(<CoreInputsForm values={DEFAULT_VALUES} onChange={vi.fn()} />)
    expect(screen.getByLabelText('Current age')).toBeInTheDocument()
    expect(screen.getByLabelText('Retirement age')).toBeInTheDocument()
    expect(screen.getByLabelText('Current investment balance')).toBeInTheDocument()
    expect(screen.getByLabelText('Current annual income')).toBeInTheDocument()
    expect(screen.getByLabelText('Annual savings percentage')).toBeInTheDocument()

    const inputs = screen.getAllByRole('spinbutton')
    expect(inputs.map((i) => i.getAttribute('id'))).toEqual([
      screen.getByLabelText('Current age').id,
      screen.getByLabelText('Retirement age').id,
      screen.getByLabelText('Current investment balance').id,
      screen.getByLabelText('Current annual income').id,
      screen.getByLabelText('Annual savings percentage').id,
    ])
  })

  it('pre-fills the sensible defaults on first load', () => {
    render(<CoreInputsForm values={DEFAULT_VALUES} onChange={vi.fn()} />)
    expect(screen.getByLabelText('Current age')).toHaveValue(35)
    expect(screen.getByLabelText('Retirement age')).toHaveValue(67)
    expect(screen.getByLabelText('Current investment balance')).toHaveValue(250000)
    expect(screen.getByLabelText('Current annual income')).toHaveValue(85000)
    expect(screen.getByLabelText('Annual savings percentage')).toHaveValue(15)
  })

  it('enforces input ranges via min/max', () => {
    render(<CoreInputsForm values={DEFAULT_VALUES} onChange={vi.fn()} />)
    expect(screen.getByLabelText('Current age')).toHaveAttribute('min', '18')
    expect(screen.getByLabelText('Current age')).toHaveAttribute('max', '100')
    expect(screen.getByLabelText('Retirement age')).toHaveAttribute('min', '18')
    expect(screen.getByLabelText('Retirement age')).toHaveAttribute('max', '100')
    expect(screen.getByLabelText('Current investment balance')).toHaveAttribute('min', '0')
    expect(screen.getByLabelText('Current investment balance')).toHaveAttribute('max', '10000000')
    expect(screen.getByLabelText('Current annual income')).toHaveAttribute('min', '0')
    expect(screen.getByLabelText('Current annual income')).toHaveAttribute('max', '5000000')
    expect(screen.getByLabelText('Annual savings percentage')).toHaveAttribute('min', '0')
    expect(screen.getByLabelText('Annual savings percentage')).toHaveAttribute('max', '100')
  })

  it('shows a validation error when a value is entered out of range, and calls onChange anyway', () => {
    render(<ControlledForm />)

    const income = screen.getByLabelText('Current annual income')
    fireEvent.change(income, { target: { value: '9000000' } })

    expect(income).toHaveValue(9000000)
    expect(screen.getByRole('alert')).toHaveTextContent(/between 0 and 5,000,000/i)
  })

  it('clears the validation error once the value is back in range', () => {
    render(<ControlledForm />)

    const income = screen.getByLabelText('Current annual income')
    fireEvent.change(income, { target: { value: '9000000' } })
    expect(screen.getByRole('alert')).toBeInTheDocument()

    fireEvent.change(income, { target: { value: '90000' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('formats balance and income fields with a $ prefix', () => {
    render(<CoreInputsForm values={DEFAULT_VALUES} onChange={vi.fn()} />)
    expect(screen.getAllByText('$')).toHaveLength(2)
  })

  it('formats the savings percentage field with a % suffix', () => {
    render(<CoreInputsForm values={DEFAULT_VALUES} onChange={vi.fn()} />)
    expect(screen.getByText('%')).toBeInTheDocument()
  })

  it('calls onChange with the updated field only, preserving the rest', () => {
    const onChange = vi.fn()
    render(<CoreInputsForm values={DEFAULT_VALUES} onChange={onChange} />)

    const age = screen.getByLabelText('Current age')
    fireEvent.change(age, { target: { value: '40' } })

    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_VALUES, currentAge: 40 })
  })
})
