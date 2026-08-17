import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { CollapsibleSection } from './CollapsibleSection'

describe('CollapsibleSection', () => {
  afterEach(() => cleanup())
  it('renders the summary as a group with the given accessible name', () => {
    render(
      <CollapsibleSection summary="Advanced assumptions">
        <p>Investment return</p>
      </CollapsibleSection>,
    )
    expect(screen.getByText('Advanced assumptions')).toBeInTheDocument()
  })

  it('is closed by default', () => {
    render(
      <CollapsibleSection summary="Advanced assumptions">
        <p>Investment return</p>
      </CollapsibleSection>,
    )
    const details = screen.getByText('Advanced assumptions').closest('details')
    expect(details).not.toHaveAttribute('open')
  })

  it('is open when defaultOpen is true', () => {
    render(
      <CollapsibleSection summary="Advanced assumptions" defaultOpen>
        <p>Investment return</p>
      </CollapsibleSection>,
    )
    const details = screen.getByText('Advanced assumptions').closest('details')
    expect(details).toHaveAttribute('open')
  })

  it('opens when the summary is clicked', async () => {
    const user = userEvent.setup()
    render(
      <CollapsibleSection summary="Advanced assumptions">
        <p>Investment return</p>
      </CollapsibleSection>,
    )

    const summary = screen.getByText('Advanced assumptions')
    await user.click(summary)

    const details = summary.closest('details')
    expect(details).toHaveAttribute('open')
  })
})
