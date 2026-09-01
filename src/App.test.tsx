import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

// jsdom has no real Worker; PlanSection's StressTestSection creates a real orchestrator by
// default, which would throw on mount. This file only needs App to render end-to-end (the
// detailed Projection/Stress Test/Settings coverage lives in src/ui/PlanSection.test.tsx per
// FIN-98), so a minimal orchestrator double is enough to let the tree render.
vi.mock('./workers', () => ({
  createMonteCarloOrchestrator: () => ({
    getState: () => ({ status: 'idle' }),
    subscribe: () => () => {},
    run: () => new Promise<never>(() => {}),
    cancel: () => {},
  }),
}))

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

// App.tsx is now a thin shell (FIN-100): it owns only `activeSection` state and composes
// TopBar + LeftNav + BottomTabBar + the active section's component. Detailed Plan-specific
// coverage (tab/form/stress-test/Settings/focus-management) lives in
// src/ui/PlanSection.test.tsx (FIN-98); this file only pins shell-level behavior — section
// switching, and that TopBar/LeftNav/BottomTabBar all render.
describe('App shell', () => {
  beforeEach(() => mockMatchMedia(true))
  afterEach(() => cleanup())

  it('renders Plan as the active section on initial load (refresh always lands on Plan)', () => {
    render(<App />)
    expect(screen.getByRole('tablist', { name: 'Views' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /investment calculator/i })).not.toBeInTheDocument()
  })

  it('renders TopBar, LeftNav, and BottomTabBar together', () => {
    render(<App />)
    expect(screen.getByText('Financial Planner')).toBeInTheDocument()
    // Both LeftNav and BottomTabBar mount unconditionally (CSS-only breakpoint controls
    // which is visible) — jsdom doesn't evaluate CSS media queries, so both are present in
    // the DOM here regardless of viewport.
    const navLandmarks = screen.getAllByRole('navigation', { name: 'Sections' })
    expect(navLandmarks).toHaveLength(2)
  })

  it('marks Plan as aria-current="page" on both nav landmarks by default', () => {
    render(<App />)
    const planButtons = screen.getAllByRole('button', { name: 'Plan' })
    const calculatorsButtons = screen.getAllByRole('button', { name: 'Calculators' })
    expect(planButtons).toHaveLength(2)
    expect(calculatorsButtons).toHaveLength(2)
    for (const button of planButtons) {
      expect(button).toHaveAttribute('aria-current', 'page')
    }
    for (const button of calculatorsButtons) {
      expect(button).not.toHaveAttribute('aria-current')
    }
  })

  it('switching to Calculators via LeftNav is a genuine unmount of Plan, not a CSS-hidden state', async () => {
    const user = userEvent.setup()
    render(<App />)

    const [leftNavCalculators] = screen.getAllByRole('button', { name: 'Calculators' })
    await user.click(leftNavCalculators)

    // Plan's whole subtree (TabBar, tabpanels) is gone from the DOM entirely — a real
    // conditional unmount — not merely hidden via CSS/attributes.
    expect(screen.queryByRole('tablist', { name: 'Views' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: /investment calculator/i })).toBeInTheDocument()

    const planButtons = screen.getAllByRole('button', { name: 'Plan' })
    const calculatorsButtons = screen.getAllByRole('button', { name: 'Calculators' })
    for (const button of calculatorsButtons) {
      expect(button).toHaveAttribute('aria-current', 'page')
    }
    for (const button of planButtons) {
      expect(button).not.toHaveAttribute('aria-current')
    }
  })

  it('switching back to Plan via BottomTabBar remounts PlanSection', async () => {
    const user = userEvent.setup()
    render(<App />)

    const [, bottomCalculators] = screen.getAllByRole('button', { name: 'Calculators' })
    await user.click(bottomCalculators)
    expect(screen.getByRole('region', { name: /investment calculator/i })).toBeInTheDocument()

    const [, bottomPlan] = screen.getAllByRole('button', { name: 'Plan' })
    await user.click(bottomPlan)

    expect(screen.getByRole('tablist', { name: 'Views' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /investment calculator/i })).not.toBeInTheDocument()
  })

  it('moves focus to the new view\'s heading on every section switch (LeftNav)', async () => {
    const user = userEvent.setup()
    render(<App />)

    const [leftNavCalculators] = screen.getAllByRole('button', { name: 'Calculators' })
    await user.click(leftNavCalculators)
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Calculators' }))

    const [leftNavPlan] = screen.getAllByRole('button', { name: 'Plan' })
    await user.click(leftNavPlan)
    // PlanSection's mount-triggers-focus effect (FIN-98) focuses the active tab's own heading
    // (Projection, the default tab) rather than a heading literally named "Plan".
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Projection' }))
  })

  it('moves focus to the new view\'s heading on every section switch (BottomTabBar)', async () => {
    const user = userEvent.setup()
    render(<App />)

    const [, bottomCalculators] = screen.getAllByRole('button', { name: 'Calculators' })
    await user.click(bottomCalculators)
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Calculators' }))

    const [, bottomPlan] = screen.getAllByRole('button', { name: 'Plan' })
    await user.click(bottomPlan)
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Projection' }))
  })

  it('has no leftover Drawer affordance anywhere in the shell', () => {
    render(<App />)
    expect(screen.queryByRole('button', { name: /collapse/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /expand/i })).not.toBeInTheDocument()
  })
})
