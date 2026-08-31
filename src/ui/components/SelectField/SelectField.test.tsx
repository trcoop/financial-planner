import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SelectField } from './SelectField'

const frequencyOptions = [
  { value: 'annually', label: 'Annually' },
  { value: 'monthly', label: 'Monthly' },
]

describe('SelectField', () => {
  afterEach(() => cleanup())

  it('associates the label with the select control', () => {
    render(
      <SelectField
        label="Compounding frequency"
        value="annually"
        onChange={vi.fn()}
        options={frequencyOptions}
      />,
    )
    expect(screen.getByLabelText('Compounding frequency')).toBeInTheDocument()
  })

  it('renders an option per entry in options, with the current value selected', () => {
    render(
      <SelectField
        label="Compounding frequency"
        value="monthly"
        onChange={vi.fn()}
        options={frequencyOptions}
      />,
    )
    const select = screen.getByLabelText('Compounding frequency') as HTMLSelectElement
    expect(select).toHaveValue('monthly')
    expect(screen.getByRole('option', { name: 'Annually' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Monthly' })).toBeInTheDocument()
  })

  it('calls onChange with the selected value when the user picks a different option', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <SelectField
        label="Compounding frequency"
        value="annually"
        onChange={onChange}
        options={frequencyOptions}
      />,
    )
    const select = screen.getByLabelText('Compounding frequency')
    await user.selectOptions(select, 'Monthly')
    expect(onChange).toHaveBeenCalledWith('monthly')
  })

  it('is operable via the keyboard', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <SelectField
        label="Compounding frequency"
        value="annually"
        onChange={onChange}
        options={frequencyOptions}
      />,
    )
    await user.tab()
    expect(screen.getByLabelText('Compounding frequency')).toHaveFocus()
    await user.selectOptions(screen.getByLabelText('Compounding frequency'), 'Monthly')
    expect(onChange).toHaveBeenCalledWith('monthly')
  })

  it('renders no error UI when error is not set', () => {
    render(
      <SelectField
        label="Compounding frequency"
        value="annually"
        onChange={vi.fn()}
        options={frequencyOptions}
      />,
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Compounding frequency')).not.toHaveAttribute('aria-invalid')
  })

  it('renders and wires an error message when error is set', () => {
    render(
      <SelectField
        label="Compounding frequency"
        value="annually"
        onChange={vi.fn()}
        options={frequencyOptions}
        error="Please choose a frequency"
      />,
    )
    const select = screen.getByLabelText('Compounding frequency')
    expect(select).toHaveAttribute('aria-invalid', 'true')

    const error = screen.getByRole('alert')
    expect(error).toHaveTextContent('Please choose a frequency')
    expect(select).toHaveAttribute('aria-describedby', error.id)
  })
})
