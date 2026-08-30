import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { NumberField } from './NumberField'

describe('NumberField', () => {
  afterEach(() => cleanup())
  it('associates the label with the input', () => {
    render(<NumberField label="Current age" value={35} onChange={vi.fn()} min={18} max={100} />)
    expect(screen.getByLabelText('Current age')).toBeInTheDocument()
  })

  it('renders the current value', () => {
    render(<NumberField label="Current age" value={35} onChange={vi.fn()} min={18} max={100} />)
    expect(screen.getByLabelText('Current age')).toHaveValue('35')
  })

  it('calls onChange with a parsed number when the user types', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    function ControlledWrapper() {
      const [value, setValue] = useState(0)
      return (
        <NumberField
          label="Current age"
          value={value}
          onChange={(newValue) => {
            onChange(newValue)
            setValue(newValue)
          }}
          min={0}
          max={100}
        />
      )
    }

    render(<ControlledWrapper />)

    const input = screen.getByLabelText('Current age')
    await user.type(input, '42')

    expect(onChange).toHaveBeenCalledWith(42)
  })

  it('does not call onChange with NaN when clearing the input', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    function ControlledWrapper() {
      const [value, setValue] = useState(35)
      return (
        <NumberField
          label="Current age"
          value={value}
          onChange={(newValue) => {
            onChange(newValue)
            setValue(newValue)
          }}
          min={18}
          max={100}
        />
      )
    }

    render(<ControlledWrapper />)

    const input = screen.getByLabelText('Current age')
    await user.clear(input)

    // Verify onChange was not called with NaN
    for (const call of onChange.mock.calls) {
      expect(Number.isFinite(call[0])).toBe(true)
    }
    // Verify onChange was not called at all (since clearing results in NaN)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('sets min and max from props', () => {
    render(<NumberField label="Current age" value={35} onChange={vi.fn()} min={18} max={100} />)
    const input = screen.getByLabelText('Current age')
    expect(input).toHaveAttribute('min', '18')
    expect(input).toHaveAttribute('max', '100')
  })

  it('renders no error UI when error is not set', () => {
    render(<NumberField label="Current age" value={35} onChange={vi.fn()} min={18} max={100} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Current age')).not.toHaveAttribute('aria-invalid')
  })

  it('renders and wires an error message when error is set', () => {
    render(
      <NumberField
        label="Current age"
        value={150}
        onChange={vi.fn()}
        min={18}
        max={100}
        error="Must be between 18 and 100"
      />,
    )

    const input = screen.getByLabelText('Current age')
    expect(input).toHaveAttribute('aria-invalid', 'true')

    const error = screen.getByRole('alert')
    expect(error).toHaveTextContent('Must be between 18 and 100')
    expect(input).toHaveAttribute('aria-describedby', error.id)
  })

  it('renders a prefix adornment baked into the input value when provided', () => {
    render(<NumberField label="Balance" value={250000} onChange={vi.fn()} min={0} max={10000000} prefix="$" />)
    expect(screen.getByLabelText('Balance')).toHaveValue('$250,000')
  })

  it('renders a suffix adornment baked into the input value when provided', () => {
    render(<NumberField label="Savings rate" value={15} onChange={vi.fn()} min={0} max={100} suffix="%" />)
    expect(screen.getByLabelText('Savings rate')).toHaveValue('15%')
  })

  it('keeps the prefix/suffix visible while typing, not just at rest', () => {
    const onChange = vi.fn()

    function ControlledWrapper() {
      const [value, setValue] = useState(15)
      return (
        <NumberField
          label="Savings rate"
          value={value}
          onChange={(newValue) => {
            onChange(newValue)
            setValue(newValue)
          }}
          min={0}
          max={100}
          suffix="%"
        />
      )
    }

    render(<ControlledWrapper />)
    const input = screen.getByLabelText('Savings rate')
    expect(input).toHaveValue('15%')

    // Simulate an in-progress keystroke: the raw event value carries the baked-in suffix too.
    fireEvent.change(input, { target: { value: '142%' } })

    expect(input).toHaveValue('142%')
    expect(onChange).toHaveBeenCalledWith(142)
  })

  it('self-heals if a keystroke eats into the suffix', () => {
    render(<NumberField label="Savings rate" value={15} onChange={vi.fn()} min={0} max={100} suffix="%" />)
    const input = screen.getByLabelText('Savings rate')

    fireEvent.change(input, { target: { value: '1425' } })

    expect(input).toHaveValue('1425%')
  })

  it('renders no adornments when prefix and suffix are not set', () => {
    render(<NumberField label="Current age" value={35} onChange={vi.fn()} min={18} max={100} />)
    expect(screen.getByLabelText('Current age')).toHaveValue('35')
  })

  it('selects only the digits on click, leaving a prefix outside the selection', async () => {
    const user = userEvent.setup()
    render(<NumberField label="Balance" value={250000} onChange={vi.fn()} min={0} max={10000000} prefix="$" />)
    const input = screen.getByLabelText('Balance') as HTMLInputElement

    await user.click(input)

    expect(input.selectionStart).toBe(1)
    expect(input.selectionEnd).toBe(input.value.length)
  })

  it('selects only the digits on click, leaving a suffix outside the selection', async () => {
    const user = userEvent.setup()
    render(<NumberField label="Savings rate" value={15} onChange={vi.fn()} min={0} max={100} suffix="%" />)
    const input = screen.getByLabelText('Savings rate') as HTMLInputElement

    await user.click(input)

    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(2)
  })

  it('selects only the digits when focused (e.g. via Tab), same as a click', () => {
    render(<NumberField label="Savings rate" value={15} onChange={vi.fn()} min={0} max={100} suffix="%" />)
    const input = screen.getByLabelText('Savings rate') as HTMLInputElement

    fireEvent.focus(input)

    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(2)
  })

  it('keeps the caret right after the typed character instead of jumping past a suffix', () => {
    const onChange = vi.fn()

    function ControlledWrapper() {
      const [value, setValue] = useState(15)
      return (
        <NumberField
          label="Savings rate"
          value={value}
          onChange={(newValue) => {
            onChange(newValue)
            setValue(newValue)
          }}
          min={0}
          max={100}
          suffix="%"
        />
      )
    }

    render(<ControlledWrapper />)
    const input = screen.getByLabelText('Savings rate') as HTMLInputElement

    // Simulate the browser having already replaced a selected "15" with "7", leaving "7%" with
    // its native caret placed right after the "7" (index 1).
    fireEvent.change(input, { target: { value: '7%', selectionStart: 1, selectionEnd: 1 } })

    expect(input.value).toBe('7%')
    expect(input.selectionStart).toBe(1)
    expect(input.selectionEnd).toBe(1)
  })

  it('keeps the caret at the typed position when an edit does not leave the full prefix intact', () => {
    const onChange = vi.fn()

    function ControlledWrapper() {
      const [value, setValue] = useState(250000)
      return (
        <NumberField
          label="Balance"
          value={value}
          onChange={(newValue) => {
            onChange(newValue)
            setValue(newValue)
          }}
          min={0}
          max={10000000}
          prefix="ID:"
        />
      )
    }

    render(<ControlledWrapper />)
    const input = screen.getByLabelText('Balance') as HTMLInputElement
    fireEvent.focus(input)

    // Simulate an edit (e.g. a paste) that replaced the prefix and leading digit with "9", so
    // the browser's own value no longer starts with the full "ID:" prefix — caret right after
    // the "9" the user just typed.
    fireEvent.change(input, { target: { value: '9250,000', selectionStart: 1, selectionEnd: 1 } })

    // The prefix is always re-appended in full on render ("ID:9250,000"); the caret should land
    // right after the "9" (index 4: "ID:9|250,000"), not shifted backward as if the full prefix
    // had been stripped when it actually wasn't there to strip.
    expect(input.value).toBe('ID:9250,000')
    expect(input.selectionStart).toBe(4)
    expect(input.selectionEnd).toBe(4)
  })
})
