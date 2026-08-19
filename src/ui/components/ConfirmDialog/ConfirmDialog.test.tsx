import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'

describe('ConfirmDialog', () => {
  afterEach(() => cleanup())

  it('renders nothing when isOpen is false', () => {
    render(
      <ConfirmDialog
        isOpen={false}
        title="Reset plan?"
        message="Clear your saved plan and reset to defaults?"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('renders the title and message as an accessible alertdialog when open', () => {
    render(
      <ConfirmDialog
        isOpen
        title="Reset plan?"
        message="Clear your saved plan and reset to defaults?"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const dialog = screen.getByRole('alertdialog', { name: 'Reset plan?' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText('Clear your saved plan and reset to defaults?')).toBeInTheDocument()
  })

  it('calls onConfirm when the confirm button is clicked', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog
        isOpen
        title="Reset plan?"
        message="Clear your saved plan and reset to defaults?"
        confirmLabel="Reset"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Reset' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel when the cancel button is clicked', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog
        isOpen
        title="Reset plan?"
        message="Clear your saved plan and reset to defaults?"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel when the backdrop is clicked', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog
        isOpen
        title="Reset plan?"
        message="Clear your saved plan and reset to defaults?"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    )

    // eslint-disable-next-line testing-library/no-node-access
    await user.click(document.querySelector('[aria-hidden="true"]') as HTMLElement)

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('does not call onCancel when clicking inside the dialog panel', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog
        isOpen
        title="Reset plan?"
        message="Clear your saved plan and reset to defaults?"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    )

    await user.click(screen.getByText('Clear your saved plan and reset to defaults?'))

    expect(onCancel).not.toHaveBeenCalled()
  })

  it('calls onCancel when Escape is pressed', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog
        isOpen
        title="Reset plan?"
        message="Clear your saved plan and reset to defaults?"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    )

    await user.keyboard('{Escape}')

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('focuses the confirm button when opened', () => {
    render(
      <ConfirmDialog
        isOpen
        title="Reset plan?"
        message="Clear your saved plan and reset to defaults?"
        confirmLabel="Reset"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Reset' })).toHaveFocus()
  })
})
