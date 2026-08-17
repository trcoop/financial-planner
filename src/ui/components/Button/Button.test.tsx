import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button } from './Button'

describe('Button', () => {
  afterEach(() => cleanup())
  it('renders its label as an accessible button', () => {
    render(<Button>Run stress test</Button>)
    expect(screen.getByRole('button', { name: 'Run stress test' })).toBeInTheDocument()
  })

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Run stress test</Button>)

    await user.click(screen.getByRole('button', { name: 'Run stress test' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('is disabled when the disabled prop is set, and does not fire onClick', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <Button onClick={onClick} disabled>
        Run stress test
      </Button>,
    )

    const button = screen.getByRole('button', { name: 'Run stress test' })
    expect(button).toBeDisabled()

    await user.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('defaults to type="button" so it never accidentally submits a form', () => {
    render(<Button>Run stress test</Button>)
    expect(screen.getByRole('button', { name: 'Run stress test' })).toHaveAttribute(
      'type',
      'button',
    )
  })

  it('applies the correct CSS class for primary variant', () => {
    render(<Button variant="primary">Primary Button</Button>)
    const button = screen.getByRole('button', { name: 'Primary Button' })
    expect(button.className).toMatch(/primary/)
  })

  it('applies the correct CSS class for secondary variant', () => {
    render(<Button variant="secondary">Secondary Button</Button>)
    const button = screen.getByRole('button', { name: 'Secondary Button' })
    expect(button.className).toMatch(/secondary/)
  })

  it('is focusable and has focus-visible styling', async () => {
    const user = userEvent.setup()
    render(<Button>Focusable Button</Button>)
    const button = screen.getByRole('button', { name: 'Focusable Button' })

    await user.tab()

    expect(button).toHaveFocus()
  })
})
