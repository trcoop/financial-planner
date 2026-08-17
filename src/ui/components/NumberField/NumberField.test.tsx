import { cleanup, render, screen } from '@testing-library/react'
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
    expect(screen.getByLabelText('Current age')).toHaveValue(35)
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

  it('renders a prefix adornment when provided', () => {
    render(<NumberField label="Balance" value={250000} onChange={vi.fn()} min={0} max={10000000} prefix="$" />)
    expect(screen.getByText('$')).toBeInTheDocument()
  })

  it('renders a suffix adornment when provided', () => {
    render(<NumberField label="Savings rate" value={15} onChange={vi.fn()} min={0} max={100} suffix="%" />)
    expect(screen.getByText('%')).toBeInTheDocument()
  })

  it('renders no adornments when prefix and suffix are not set', () => {
    render(<NumberField label="Current age" value={35} onChange={vi.fn()} min={18} max={100} />)
    expect(screen.queryByText('$')).not.toBeInTheDocument()
    expect(screen.queryByText('%')).not.toBeInTheDocument()
  })
})
