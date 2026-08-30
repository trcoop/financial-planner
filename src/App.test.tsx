import { cleanup, render, screen } from '@testing-library/react'
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

// App.tsx is now a thin composition of TopBar + PlanSection (FIN-98) — its own detailed
// tab/form/stress-test/Settings/focus-management coverage moved to
// src/ui/PlanSection.test.tsx, which App.tsx just mounts. This file only pins that App still
// renders the whole shell end-to-end. (App.tsx's further thin-shell rewrite, e.g. breakpoint
// switching to LeftNav/BottomTabBar, is FIN-100's scope, not this ticket's.)
describe('App shell', () => {
  beforeEach(() => mockMatchMedia(true))
  afterEach(() => cleanup())

  it('renders TopBar and PlanSection together, with the Projection tab active by default', () => {
    render(<App />)
    expect(screen.getByText('Financial Planner')).toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: 'Views' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Projection' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Stress Test' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Current investment balance' })).toBeInTheDocument()
  })

  it('has no leftover Drawer affordance anywhere in the shell', () => {
    render(<App />)
    expect(screen.queryByRole('button', { name: /collapse/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /expand/i })).not.toBeInTheDocument()
  })
})
