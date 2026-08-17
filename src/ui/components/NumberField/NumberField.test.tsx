import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
    render(<NumberField label="Current age" value={35} onChange={onChange} min={18} max={100} />)

    const input = screen.getByLabelText('Current age')
    await user.clear(input)
    await user.type(input, '4')

    expect(onChange).toHaveBeenCalledWith(4)
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
})
