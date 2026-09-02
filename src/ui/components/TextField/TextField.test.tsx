import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TextField } from './TextField'

describe('TextField', () => {
  afterEach(() => cleanup())

  it('renders a labeled text input with the given value', () => {
    render(<TextField label="Name" value="Alice" onChange={vi.fn()} />)
    expect(screen.getByLabelText('Name')).toHaveValue('Alice')
  })

  it('calls onChange with the new text on input', () => {
    const onChange = vi.fn()
    render(<TextField label="Name" value="" onChange={onChange} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Bob' } })

    expect(onChange).toHaveBeenCalledWith('Bob')
  })

  it('shows an error message when provided', () => {
    render(<TextField label="Name" value="" onChange={vi.fn()} error="Required" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Required')
  })

  it('does not render an alert when there is no error', () => {
    render(<TextField label="Name" value="" onChange={vi.fn()} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
