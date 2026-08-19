import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { Drawer } from './Drawer'

/**
 * Mocks window.matchMedia to report whether the viewport is at/above the
 * 960px desktop breakpoint. Drawer reads this at mount to pick its default
 * open/collapsed state, and subscribes to 'change' events on the returned
 * MediaQueryList to keep that default reactive to resize/orientation
 * changes. Returns a helper to simulate such a change from the test.
 */
function mockMatchMedia(isDesktop: boolean) {
  let matches = isDesktop
  const changeListeners = new Set<(event: MediaQueryListEvent) => void>()

  window.matchMedia = ((query: string) => ({
    get matches() {
      return matches
    },
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: (type: string, listener: (event: MediaQueryListEvent) => void) => {
      if (type === 'change') changeListeners.add(listener)
    },
    removeEventListener: (type: string, listener: (event: MediaQueryListEvent) => void) => {
      if (type === 'change') changeListeners.delete(listener)
    },
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia

  return {
    simulateChange(nextIsDesktop: boolean) {
      matches = nextIsDesktop
      const event = { matches: nextIsDesktop } as MediaQueryListEvent
      act(() => {
        changeListeners.forEach((listener) => listener(event))
      })
    },
    listenerCount() {
      return changeListeners.size
    },
  }
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

  describe('reacting to viewport changes after mount', () => {
    it('opens when the viewport grows past the desktop breakpoint', () => {
      const { simulateChange } = mockMatchMedia(false)
      render(
        <Drawer label="Plan inputs">
          <p>Investment return</p>
        </Drawer>,
      )
      expect(screen.getByRole('button', { name: /expand/i })).toBeInTheDocument()

      simulateChange(true)

      const toggle = screen.getByRole('button', { name: /collapse/i })
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByText('Investment return')).toBeVisible()
    })

    it('collapses when the viewport shrinks below the desktop breakpoint', () => {
      const { simulateChange } = mockMatchMedia(true)
      render(
        <Drawer label="Plan inputs">
          <p>Investment return</p>
        </Drawer>,
      )
      expect(screen.getByRole('button', { name: /collapse/i })).toBeInTheDocument()

      simulateChange(false)

      const toggle = screen.getByRole('button', { name: /expand/i })
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(screen.getByText('Investment return')).not.toBeVisible()
    })

    it('does not override an explicit manual toggle on a subsequent viewport change', async () => {
      const { simulateChange } = mockMatchMedia(true)
      const user = userEvent.setup()
      render(
        <Drawer label="Plan inputs">
          <p>Investment return</p>
        </Drawer>,
      )

      // User manually collapses at desktop width.
      await user.click(screen.getByRole('button', { name: /collapse/i }))
      expect(screen.getByRole('button', { name: /expand/i })).toBeInTheDocument()

      // A viewport change that would otherwise re-open it should not undo
      // the user's explicit choice.
      simulateChange(true)

      expect(screen.getByRole('button', { name: /expand/i })).toBeInTheDocument()
    })

    it('removes its matchMedia change listener on unmount', () => {
      const { listenerCount, simulateChange } = mockMatchMedia(true)
      const { unmount } = render(
        <Drawer label="Plan inputs">
          <p>Investment return</p>
        </Drawer>,
      )
      expect(listenerCount()).toBe(1)

      unmount()

      expect(listenerCount()).toBe(0)
      // A change firing after unmount must not throw or warn about updating
      // an unmounted component — there's no listener left to receive it.
      expect(() => simulateChange(false)).not.toThrow()
    })

    it('does not tear down and resubscribe its matchMedia listener on toggle', async () => {
      const { listenerCount } = mockMatchMedia(true)
      const user = userEvent.setup()
      render(
        <Drawer label="Plan inputs">
          <p>Investment return</p>
        </Drawer>,
      )
      expect(listenerCount()).toBe(1)

      await user.click(screen.getByRole('button', { name: /collapse/i }))
      await user.click(screen.getByRole('button', { name: /expand/i }))

      expect(listenerCount()).toBe(1)
    })
  })
})
