import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Checkbox } from './Checkbox'

describe('Checkbox', () => {
  afterEach(() => cleanup())

  it('renders with its label', () => {
    render(<Checkbox checked={false} onChange={vi.fn()} label="Has a spouse" />)
    expect(screen.getByLabelText('Has a spouse')).toBeInTheDocument()
  })

  it('reflects the checked prop', () => {
    render(<Checkbox checked={true} onChange={vi.fn()} label="Has a spouse" />)
    expect(screen.getByLabelText('Has a spouse')).toBeChecked()
  })

  it('reflects an unchecked checked prop', () => {
    render(<Checkbox checked={false} onChange={vi.fn()} label="Has a spouse" />)
    expect(screen.getByLabelText('Has a spouse')).not.toBeChecked()
  })

  it('calls onChange(true) when clicking the unchecked input', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Checkbox checked={false} onChange={onChange} label="Has a spouse" />)

    await user.click(screen.getByLabelText('Has a spouse'))

    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('calls onChange(false) when clicking the checked input', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Checkbox checked={true} onChange={onChange} label="Has a spouse" />)

    await user.click(screen.getByLabelText('Has a spouse'))

    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('toggles when clicking the label text', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Checkbox checked={false} onChange={onChange} label="Has a spouse" />)

    await user.click(screen.getByText('Has a spouse'))

    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('toggles via keyboard (space) when focused', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Checkbox checked={false} onChange={onChange} label="Has a spouse" />)

    await user.tab()
    expect(screen.getByLabelText('Has a spouse')).toHaveFocus()
    await user.keyboard(' ')

    expect(onChange).toHaveBeenCalledWith(true)
  })
})
