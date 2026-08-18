import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { Drawer } from './Drawer'

/**
 * Mocks window.matchMedia to report whether the viewport is at/above the
 * 960px desktop breakpoint. Drawer reads this once at mount to pick its
 * default open/collapsed state.
 */
function mockMatchMedia(isDesktop: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: isDesktop,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

describe('Drawer', () => {
  afterEach(() => cleanup())

  describe('at desktop widths (>= 960px)', () => {
    it('defaults to open', () => {
      mockMatchMedia(true)
      render(
        <Drawer label="Plan inputs">
          <p>Investment return</p>
        </Drawer>,
      )
      const toggle = screen.getByRole('button', { name: /collapse/i })
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByText('Investment return')).toBeVisible()
    })

    it('collapses content and flips the affordance when toggled', async () => {
      mockMatchMedia(true)
      const user = userEvent.setup()
      render(
        <Drawer label="Plan inputs">
          <p>Investment return</p>
        </Drawer>,
      )

      await user.click(screen.getByRole('button', { name: /collapse/i }))

      const toggle = screen.getByRole('button', { name: /expand/i })
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(screen.getByText('Investment return')).not.toBeVisible()
    })
  })

  describe('at mobile widths (< 960px)', () => {
    it('defaults to collapsed', () => {
      mockMatchMedia(false)
      render(
        <Drawer label="Plan inputs">
          <p>Investment return</p>
        </Drawer>,
      )
      const toggle = screen.getByRole('button', { name: /expand/i })
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(screen.getByText('Investment return')).not.toBeVisible()
    })

    it('expands content and flips the affordance when toggled', async () => {
      mockMatchMedia(false)
      const user = userEvent.setup()
      render(
        <Drawer label="Plan inputs">
          <p>Investment return</p>
        </Drawer>,
      )

      await user.click(screen.getByRole('button', { name: /expand/i }))

      const toggle = screen.getByRole('button', { name: /collapse/i })
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByText('Investment return')).toBeVisible()
    })
  })

  it('wraps arbitrary children content', () => {
    mockMatchMedia(true)
    render(
      <Drawer label="Plan inputs">
        <p>Core inputs form</p>
        <p>Advanced assumptions form</p>
      </Drawer>,
    )
    expect(screen.getByText('Core inputs form')).toBeInTheDocument()
    expect(screen.getByText('Advanced assumptions form')).toBeInTheDocument()
  })

  it('exposes the wrapped content as a labeled region', () => {
    mockMatchMedia(true)
    render(
      <Drawer label="Plan inputs">
        <p>Investment return</p>
      </Drawer>,
    )
    const region = screen.getByRole('region', { name: 'Plan inputs' })
    expect(region).toHaveTextContent('Investment return')
  })

  it('wires the toggle to the content region via aria-controls', () => {
    mockMatchMedia(true)
    render(
      <Drawer label="Plan inputs">
        <p>Investment return</p>
      </Drawer>,
    )
    const toggle = screen.getByRole('button', { name: /collapse/i })
    const region = screen.getByRole('region', { name: 'Plan inputs' })
    expect(toggle).toHaveAttribute('aria-controls', region.id)
  })
})
