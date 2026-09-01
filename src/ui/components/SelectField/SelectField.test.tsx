import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SelectField } from './SelectField'

const frequencyOptions = [
  { value: 'annually', label: 'Annually' },
  { value: 'monthly', label: 'Monthly' },
]

describe('SelectField', () => {
  afterEach(() => cleanup())

  it('associates the label with the control', () => {
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

  it('shows the current value as the trigger label, and lists every option when opened', async () => {
    const user = userEvent.setup()
    render(
      <SelectField
        label="Compounding frequency"
        value="monthly"
        onChange={vi.fn()}
        options={frequencyOptions}
      />,
    )
    const trigger = screen.getByLabelText('Compounding frequency')
    expect(trigger).toHaveTextContent('Monthly')

    await user.click(trigger)
    const listbox = screen.getByRole('listbox')
    expect(within(listbox).getByRole('option', { name: 'Annually' })).toBeInTheDocument()
    expect(within(listbox).getByRole('option', { name: 'Monthly' })).toBeInTheDocument()
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
    const trigger = screen.getByLabelText('Compounding frequency')
    await user.click(trigger)
    await user.click(screen.getByRole('option', { name: 'Monthly' }))
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
    const trigger = screen.getByLabelText('Compounding frequency')
    expect(trigger).toHaveFocus()

    await user.keyboard('{Enter}')
    // Select-only-combobox pattern: focus stays on the trigger the whole time (see Dropdown.tsx).
    expect(trigger).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')
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
    const trigger = screen.getByLabelText('Compounding frequency')
    expect(trigger).toHaveAttribute('aria-invalid', 'true')

    const error = screen.getByRole('alert')
    expect(error).toHaveTextContent('Please choose a frequency')
    expect(trigger).toHaveAttribute('aria-describedby', error.id)
  })
})
