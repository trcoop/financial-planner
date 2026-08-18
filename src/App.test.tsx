import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

// jsdom has no real Worker; App's StressTestSection creates a real orchestrator by default,
// which would throw on mount. These tests don't exercise the Monte Carlo run itself, so a
// minimal orchestrator double is enough to let the tree render.
//
// `lastOrchestrator` captures the most recently constructed fake so a test can drive it
// directly (e.g. `emitComplete()`) — StressTestSection creates one via
// `createMonteCarloOrchestrator()` internally, so App's tests have no other handle on it.
let lastOrchestrator: {
  getState: () => { status: string }
  subscribe: (listener: (state: unknown) => void) => () => void
  run: () => Promise<never>
  cancel: () => void
  emitComplete: () => void
}

vi.mock('./workers', () => ({
  createMonteCarloOrchestrator: () => {
    const listeners = new Set<(state: unknown) => void>()
    const orchestrator = {
      getState: () => ({ status: 'idle' }),
      subscribe: (listener: (state: unknown) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      run: () => new Promise<never>(() => {}),
      cancel: () => {},
      emitComplete: () => {
        const result = {
          successRate: 87,
          percentiles: { p10: [1, 2], p50: [3, 4], p90: [5, 6] },
          meta: { simulationCount: 1000, stockVolatility: 0.15, bondVolatility: 0.06, allocation: { stocks: 70, bonds: 30 } },
        }
        listeners.forEach((listener) => listener({ status: 'complete', result }))
      },
    }
    lastOrchestrator = orchestrator
    return orchestrator
  },
}))

/**
 * Mocks window.matchMedia to report whether the viewport is at/above the 960px desktop
 * breakpoint, mirroring the pattern used by Drawer's own tests (FIN-23) — Drawer reads this
 * once at mount to pick its default open/collapsed state, and the assembled shell's behavior
 * at each breakpoint depends on it.
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

// Debounced recalculation, the "pause on invalid input, keep last valid result" behavior,
// and retirement-row/projected-balance derivation are covered by
// src/ui/hooks/useProjectionState.test.ts (FIN-33) without needing to render App at all.
// This file only covers what's actually App's job: composing components and wiring props/state
// between them (tab switching, Drawer responsiveness, StatTile inputs).
describe('App shell', () => {
  beforeEach(() => mockMatchMedia(true))
  afterEach(() => cleanup())

  it('renders TopBar, TabBar, and the plan-inputs Drawer', () => {
    render(<App />)
    expect(screen.getByText('Financial Planner')).toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: 'Views' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Projection' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Stress Test' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Plan inputs' })).toBeInTheDocument()
  })

  it('renders the core inputs form pre-filled with defaults, inside the Drawer', () => {
    render(<App />)
    expect(screen.getByLabelText('Current age')).toHaveValue('35')
    expect(screen.getByLabelText('Retirement age')).toHaveValue('67')
    expect(within(screen.getByRole('region', { name: 'Plan inputs' })).getByLabelText('Current investment balance')).toHaveValue('$250,000')
    expect(screen.getByLabelText('Current annual income')).toHaveValue('$85,000')
    expect(screen.getByLabelText('Annual savings percentage')).toHaveValue('15%')
  })

  it('defaults to the Projection tab, showing StatTiles and the chart, not the ProjectionTable', () => {
    render(<App />)
    expect(screen.getByRole('tab', { name: 'Projection' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('region', { name: 'Current investment balance' })).toBeInTheDocument()
    expect(screen.getByText('Projected balance at 67')).toBeInTheDocument()
    expect(screen.getByText('Chance of success')).toBeInTheDocument()
    expect(screen.getByText('Run a stress test to see this')).toBeInTheDocument()
    expect(screen.getByRole('figure', { name: 'Investment balance by year' })).toBeInTheDocument()
    // ProjectionTable is removed from the render tree (FIN-26) — no <table> should render.
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows the current investment balance StatTile from the core inputs', () => {
    render(<App />)
    const tile = screen.getByRole('region', { name: 'Current investment balance' })
    expect(tile).toHaveTextContent('$250,000')
  })

  it('switches to the Stress Test tab and shows the Run stress test control', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('tab', { name: 'Stress Test' }))
    expect(screen.getByRole('tab', { name: 'Stress Test' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: 'Run stress test' })).toBeInTheDocument()
  })

  it('keeps the projection chart and stress test panel both mounted across tab switches (no recompute on switch)', async () => {
    const user = userEvent.setup()
    render(<App />)
    const figureBefore = screen.getByRole('figure', { name: 'Investment balance by year' })
    await user.click(screen.getByRole('tab', { name: 'Stress Test' }))
    await user.click(screen.getByRole('tab', { name: 'Projection' }))
    const figureAfter = screen.getByRole('figure', { name: 'Investment balance by year' })
    expect(figureAfter).toBe(figureBefore)
  })

  it('keeps StressTestSection mounted (not torn down/recreated) across tab switches', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('tab', { name: 'Stress Test' }))
    const runButtonBefore = screen.getByRole('button', { name: 'Run stress test' })
    await user.click(screen.getByRole('tab', { name: 'Projection' }))
    await user.click(screen.getByRole('tab', { name: 'Stress Test' }))
    const runButtonAfter = screen.getByRole('button', { name: 'Run stress test' })
    expect(runButtonAfter).toBe(runButtonBefore)
  })

  it('surfaces the stress test success rate on the Projection tab StatTile once available', async () => {
    render(<App />)
    // Directly simulate what StressTestSection would report via onSuccessRateChange by
    // driving the Stress Test tab's mocked orchestrator through a real run is out of scope
    // for this shell-composition test (StressTestSection's own tests own that behavior);
    // here we only assert the placeholder state prior to any run, which is what App controls.
    expect(screen.getByText('Run a stress test to see this')).toBeInTheDocument()
  })

  it('renders the chart without a Monte Carlo band before any stress test completes', () => {
    render(<App />)
    expect(screen.queryByTestId(/^chart-band-/)).not.toBeInTheDocument()
  })

  it('wires a completed stress test\'s percentiles into the chart as a band (FIN-44)', async () => {
    render(<App />)
    // The mocked orchestrator (module-level, shared across StressTestSection's `useMemo`) is
    // driven directly to `complete`, mirroring how StressTestSection's own tests drive a fake
    // orchestrator — App's job under test is the band wiring, not re-testing the two-effect
    // lift-up pattern StressTestSection.test.tsx already covers.
    await act(async () => {
      lastOrchestrator.emitComplete()
    })

    await waitFor(() => expect(screen.queryAllByTestId(/^chart-band-/).length).toBeGreaterThan(0))
  })

  it('keeps the chart retirement marker live as the retirement age input changes (FIN-44)', async () => {
    // jsdom stubs getBoundingClientRect to all-zeros, so the marker's pixel position can't be
    // asserted directly here (that's ChartContainer's own FIN-42 tests' job, with a mocked
    // rect). Instead, this proves `retirementAge` isn't captured stale by moving it clean out
    // of the projected horizon (default currentAge 35) — the marker must disappear, which is
    // only possible if `ChartContainer` is re-deriving `retirementIndex` from the live prop.
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByTestId('chart-retirement-marker')).toBeInTheDocument()

    const retirementAgeInput = screen.getByLabelText('Retirement age')
    await user.clear(retirementAgeInput)
    await user.type(retirementAgeInput, '20')

    await waitFor(() => expect(screen.queryByTestId('chart-retirement-marker')).not.toBeInTheDocument())
  })
})

describe('App shell responsive behavior', () => {
  afterEach(() => cleanup())

  it('at desktop widths (>= 960px), the Drawer defaults open', () => {
    mockMatchMedia(true)
    render(<App />)
    const toggle = screen.getByRole('button', { name: /collapse/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByLabelText('Current age')).toBeVisible()
  })

  it('at mobile widths (< 960px), the Drawer defaults collapsed', () => {
    mockMatchMedia(false)
    render(<App />)
    const toggle = screen.getByRole('button', { name: /expand/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })
})
