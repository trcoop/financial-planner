import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanSection } from './PlanSection'
import { STORAGE_KEY } from '../storage'

/** Minimal in-memory fake matching the `Storage` interface, mirroring the one used by
 * `src/storage/assumptionsStorage.test.ts` (FIN-41) — this environment's `window.localStorage`
 * is not a real `Storage` implementation (no `removeItem`/`clear`), so tests that exercise
 * persistence stub it in per-test rather than relying on jsdom's default. */
function createFakeStorage(): Storage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size
    },
  }
}

// jsdom has no real Worker; PlanSection's StressTestSection creates a real orchestrator by
// default, which would throw on mount. These tests don't exercise the Monte Carlo run itself,
// so a minimal orchestrator double is enough to let the tree render.
//
// `lastOrchestrator` captures the most recently constructed fake so a test can drive it
// directly (e.g. `emitComplete()`) — StressTestSection creates one via
// `createMonteCarloOrchestrator()` internally, so these tests have no other handle on it.
let lastOrchestrator: {
  getState: () => { status: string }
  subscribe: (listener: (state: unknown) => void) => () => void
  run: (...args: unknown[]) => Promise<never>
  cancel: () => void
  emitComplete: () => void
  runCalls: unknown[][]
}

vi.mock('../workers', () => ({
  createMonteCarloOrchestrator: () => {
    const listeners = new Set<(state: unknown) => void>()
    const runCalls: unknown[][] = []
    const orchestrator = {
      getState: () => ({ status: 'idle' }),
      subscribe: (listener: (state: unknown) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      run: (...args: unknown[]) => {
        runCalls.push(args)
        return new Promise<never>(() => {})
      },
      runCalls,
      cancel: () => {},
      emitComplete: () => {
        const result = {
          successRate: 87,
          // Distinct fans so an assertion about the chart cannot pass on the wrong one
          // (FIN-65 change 3 — the Stress Test chart plots `real`).
          percentiles: {
            real: { p10: [1, 2], p50: [3, 4], p90: [5, 6] },
            nominal: { p10: [10, 20], p50: [30, 40], p90: [50, 60] },
          },
          meta: { simulationCount: 1000, stockVolatility: 0.15, bondVolatility: 0.06, allocation: { stocks: 70, bonds: 30 } },
        }
        listeners.forEach((listener) => listener({ status: 'complete', result }))
      },
    }
    lastOrchestrator = orchestrator
    return orchestrator
  },
}))

/** Mocks window.matchMedia — some underlying components (StatTile, TopBar, TabBar, Layout) key
 * off the app's shared desktop breakpoint. */
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
// src/ui/hooks/useProjectionState.test.ts (FIN-33) without needing to render PlanSection at all.
// This file covers what's actually PlanSection's job: composing components and wiring
// props/state between them (tab switching, forms, stress test, and — since FIN-98/FIN-88 — the
// Settings tab that replaced the old Drawer).
describe('PlanSection', () => {
  beforeEach(() => mockMatchMedia(true))
  afterEach(() => cleanup())

  it('renders its own TabBar with Projection, Stress Test, and Settings tabs', () => {
    render(<PlanSection />)
    expect(screen.getByRole('tablist', { name: 'Views' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Projection' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Stress Test' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Settings' })).toBeInTheDocument()
  })

  it('defaults to the Projection tab, showing StatTiles and the chart, not the ProjectionTable', () => {
    render(<PlanSection />)
    expect(screen.getByRole('tab', { name: 'Projection' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('region', { name: 'Current investment balance' })).toBeInTheDocument()
    expect(screen.getByText('Projected balance at 65')).toBeInTheDocument()
    expect(screen.getByText('Chance of success')).toBeInTheDocument()
    expect(screen.getByText('Run a stress test to see this')).toBeInTheDocument()
    expect(screen.getByRole('figure', { name: 'Investment balance by year' })).toBeInTheDocument()
    // ProjectionTable is removed from the render tree (FIN-26) — no <table> should render.
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows the current investment balance StatTile from the core inputs', () => {
    render(<PlanSection />)
    const tile = screen.getByRole('region', { name: 'Current investment balance' })
    expect(tile).toHaveTextContent('$250,000')
  })

  it('switches to the Stress Test tab and shows the Run stress test control', async () => {
    const user = userEvent.setup()
    render(<PlanSection />)
    await user.click(screen.getByRole('tab', { name: 'Stress Test' }))
    expect(screen.getByRole('tab', { name: 'Stress Test' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: 'Run stress test' })).toBeInTheDocument()
  })

  it('keeps the projection chart and stress test panel both mounted across tab switches (no recompute on switch)', async () => {
    const user = userEvent.setup()
    render(<PlanSection />)
    const figureBefore = screen.getByRole('figure', { name: 'Investment balance by year' })
    await user.click(screen.getByRole('tab', { name: 'Stress Test' }))
    await user.click(screen.getByRole('tab', { name: 'Projection' }))
    const figureAfter = screen.getByRole('figure', { name: 'Investment balance by year' })
    expect(figureAfter).toBe(figureBefore)
  })

  it('keeps StressTestSection mounted (not torn down/recreated) across tab switches', async () => {
    const user = userEvent.setup()
    render(<PlanSection />)
    await user.click(screen.getByRole('tab', { name: 'Stress Test' }))
    const runButtonBefore = screen.getByRole('button', { name: 'Run stress test' })
    await user.click(screen.getByRole('tab', { name: 'Projection' }))
    await user.click(screen.getByRole('tab', { name: 'Stress Test' }))
    const runButtonAfter = screen.getByRole('button', { name: 'Run stress test' })
    expect(runButtonAfter).toBe(runButtonBefore)
  })

  it('renders no Monte Carlo overlay on the Plan tab\'s chart (FIN-47: band overlay removed entirely)', async () => {
    render(<PlanSection />)
    await act(async () => {
      lastOrchestrator.emitComplete()
    })
    expect(screen.queryByTestId(/^chart-band-/)).not.toBeInTheDocument()
  })

  it('wires a completed stress test\'s percentiles into a dedicated line chart on the Stress Test tab (FIN-47)', async () => {
    const user = userEvent.setup()
    render(<PlanSection />)
    await act(async () => {
      lastOrchestrator.emitComplete()
    })
    await user.click(screen.getByRole('tab', { name: 'Stress Test' }))

    const chart = await screen.findByRole('figure')
    expect(chart).toBeInTheDocument()
    expect(within(chart).getByText(/median.*50th percentile/i)).toBeInTheDocument()
  })

  it('does not show the re-run CTA when inputs change before any stress test has ever completed (FIN-48)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    try {
      render(<PlanSection />)
      expect(screen.getByText('Run a stress test to see this')).toBeInTheDocument()

      await user.click(screen.getByRole('tab', { name: 'Settings' }))
      const ageInput = screen.getByLabelText('Current age')
      await user.clear(ageInput)
      await user.type(ageInput, '40')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(350)
      })

      await user.click(screen.getByRole('tab', { name: 'Projection' }))
      expect(screen.getByText('Run a stress test to see this')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Re-run stress test' })).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('swaps the success rate for a "Re-run stress test" CTA once inputs change after a completed run (FIN-48)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    try {
      render(<PlanSection />)
      act(() => {
        lastOrchestrator.emitComplete()
      })
      expect(screen.getByText('87%')).toBeInTheDocument()

      await user.click(screen.getByRole('tab', { name: 'Settings' }))
      const ageInput = screen.getByLabelText('Current age')
      await user.clear(ageInput)
      await user.type(ageInput, '40')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(350)
      })

      await user.click(screen.getByRole('tab', { name: 'Projection' }))
      expect(screen.queryByText('87%')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Re-run stress test' })).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-running the stress test from the stale CTA triggers a run without switching tabs (FIN-48)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    try {
      render(<PlanSection />)
      act(() => {
        lastOrchestrator.emitComplete()
      })
      expect(screen.getByText('87%')).toBeInTheDocument()

      await user.click(screen.getByRole('tab', { name: 'Settings' }))
      const ageInput = screen.getByLabelText('Current age')
      await user.clear(ageInput)
      await user.type(ageInput, '40')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(350)
      })
      await user.click(screen.getByRole('tab', { name: 'Projection' }))

      const runsBefore = lastOrchestrator.runCalls.length
      await user.click(screen.getByRole('button', { name: 'Re-run stress test' }))

      expect(lastOrchestrator.runCalls.length).toBe(runsBefore + 1)
      // Still on the Projection tab — no tab switch happened.
      expect(screen.getByRole('tab', { name: 'Projection' })).toHaveAttribute('aria-selected', 'true')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the chart retirement marker live as the retirement age input changes (FIN-44)', async () => {
    const user = userEvent.setup()
    render(<PlanSection />)

    expect(screen.getByTestId('percentile-chart-retirement-marker')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Settings' }))
    const retirementAgeInput = screen.getByLabelText('Retirement age')
    await user.clear(retirementAgeInput)
    await user.type(retirementAgeInput, '20')
    await user.click(screen.getByRole('tab', { name: 'Projection' }))

    await waitFor(() => expect(screen.queryByTestId('percentile-chart-retirement-marker')).not.toBeInTheDocument())
  })

  it('shows the Medicare-start marker by default, and suppresses it once current age reaches 65 (FIN-73)', async () => {
    const user = userEvent.setup()
    render(<PlanSection />)

    expect(screen.getByTestId('percentile-chart-medicare-marker')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Settings' }))
    const ageInput = screen.getByLabelText('Current age')
    await user.clear(ageInput)
    await user.type(ageInput, '65')
    await user.click(screen.getByRole('tab', { name: 'Projection' }))

    await waitFor(() => expect(screen.queryByTestId('percentile-chart-medicare-marker')).not.toBeInTheDocument())
  })

  it('states the display unit under the tab bar, exactly once (FIN-65 change 3)', () => {
    render(<PlanSection />)
    expect(screen.getAllByText(/today.s dollars/i)).toHaveLength(1)
  })
})

describe('PlanSection Settings tab (FIN-98/FIN-88: replaces the Drawer)', () => {
  beforeEach(() => mockMatchMedia(true))
  afterEach(() => cleanup())

  it('shows Core Inputs, Advanced Assumptions, and a reset button, full-width, with no leftover Drawer affordance', async () => {
    const user = userEvent.setup()
    render(<PlanSection />)

    await user.click(screen.getByRole('tab', { name: 'Settings' }))
    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true')

    expect(screen.getByLabelText('Current age')).toBeInTheDocument()
    expect(screen.getByLabelText('Retirement age')).toBeInTheDocument()
    expect(screen.getByText('Advanced assumptions')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset to defaults' })).toBeInTheDocument()

    // The old Drawer's open/collapse toggle is gone entirely.
    expect(screen.queryByRole('button', { name: /collapse/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /expand/i })).not.toBeInTheDocument()
  })

  it('reflects a value changed in Settings once switched to Projection', async () => {
    const user = userEvent.setup()
    render(<PlanSection />)

    await user.click(screen.getByRole('tab', { name: 'Settings' }))
    const balanceInput = screen.getByRole('textbox', { name: 'Current investment balance' })
    await user.clear(balanceInput)
    await user.type(balanceInput, '500000')

    await user.click(screen.getByRole('tab', { name: 'Projection' }))
    expect(screen.getByRole('region', { name: 'Current investment balance' })).toHaveTextContent('$500,000')
  })

  it('clicking Reset from Settings triggers the existing reset confirmation flow', async () => {
    const user = userEvent.setup()
    render(<PlanSection />)

    await user.click(screen.getByRole('tab', { name: 'Settings' }))
    await user.click(screen.getByRole('button', { name: 'Reset to defaults' }))

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText('Reset to defaults?')).toBeInTheDocument()
  })

  it('reset control clears storage and reverts to defaults with no reload, on confirm', async () => {
    vi.stubGlobal('localStorage', createFakeStorage())
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    try {
      render(<PlanSection />)
      await user.click(screen.getByRole('tab', { name: 'Settings' }))
      const ageInput = screen.getByLabelText('Current age')
      await user.clear(ageInput)
      await user.type(ageInput, '50')
      await vi.advanceTimersByTimeAsync(350)
      expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull()

      await user.click(screen.getByRole('button', { name: 'Reset to defaults' }))
      await user.click(screen.getByRole('button', { name: 'Reset' }))

      expect(screen.getByLabelText('Current age')).toHaveValue('35')
      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })
})

describe('PlanSection focus management (FIN-98: mount-triggers-focus on internal tab switch)', () => {
  beforeEach(() => mockMatchMedia(true))
  afterEach(() => cleanup())

  it('moves focus to the Stress Test heading when switching to that tab', async () => {
    const user = userEvent.setup()
    render(<PlanSection />)

    await user.click(screen.getByRole('tab', { name: 'Stress Test' }))

    expect(screen.getByRole('heading', { name: 'Stress Test' })).toHaveFocus()
  })

  it('moves focus to the Settings heading when switching to that tab', async () => {
    const user = userEvent.setup()
    render(<PlanSection />)

    await user.click(screen.getByRole('tab', { name: 'Settings' }))

    expect(screen.getByRole('heading', { name: 'Settings' })).toHaveFocus()
  })

  it('moves focus back to the Projection heading when switching back', async () => {
    const user = userEvent.setup()
    render(<PlanSection />)

    await user.click(screen.getByRole('tab', { name: 'Settings' }))
    await user.click(screen.getByRole('tab', { name: 'Projection' }))

    expect(screen.getByRole('heading', { name: 'Projection' })).toHaveFocus()
  })

  it('each tabpanel heading is focusable only programmatically (tabIndex -1)', () => {
    render(<PlanSection />)
    expect(screen.getByRole('heading', { name: 'Projection' })).toHaveAttribute('tabIndex', '-1')
  })
})

describe('PlanSection persistence (FIN-43)', () => {
  beforeEach(() => {
    mockMatchMedia(true)
    vi.stubGlobal('localStorage', createFakeStorage())
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('restores previously edited values across an unmount/remount (reload-equivalent)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    try {
      const { unmount } = render(<PlanSection />)
      await user.click(screen.getByRole('tab', { name: 'Settings' }))
      const ageInput = screen.getByLabelText('Current age')
      await user.clear(ageInput)
      await user.type(ageInput, '42')
      await vi.advanceTimersByTimeAsync(350)

      unmount()
      render(<PlanSection />)
      await user.click(screen.getByRole('tab', { name: 'Settings' }))

      expect(screen.getByLabelText('Current age')).toHaveValue('42')
    } finally {
      vi.useRealTimers()
    }
  })

  it('saves exactly once per settled (debounced) change, not per keystroke', async () => {
    vi.doMock('../storage', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../storage')>()
      return { ...actual, saveAssumptions: vi.fn(actual.saveAssumptions) }
    })

    vi.resetModules()
    const { PlanSection: FreshPlanSection } = await import('./PlanSection')
    const storageModule = await import('../storage')
    const mockedSave = storageModule.saveAssumptions as unknown as ReturnType<typeof vi.fn>

    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    try {
      render(<FreshPlanSection />)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(350) // let the mount-time save settle
      })
      mockedSave.mockClear() // ignore the mount-time save

      await user.click(screen.getByRole('tab', { name: 'Settings' }))
      const ageInput = screen.getByLabelText('Current age')
      await user.clear(ageInput)
      await user.type(ageInput, '5')
      await user.type(ageInput, '0')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(350)
      })

      expect(mockedSave).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
      vi.doUnmock('../storage')
      vi.resetModules()
    }
  })

  it('never saves on chart selection or tab switches', async () => {
    vi.doMock('../storage', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../storage')>()
      return { ...actual, saveAssumptions: vi.fn(actual.saveAssumptions) }
    })
    vi.resetModules()
    const { PlanSection: FreshPlanSection } = await import('./PlanSection')
    const storageModule = await import('../storage')
    const mockedSave = storageModule.saveAssumptions as unknown as ReturnType<typeof vi.fn>

    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    try {
      render(<FreshPlanSection />)
      await vi.advanceTimersByTimeAsync(350)
      mockedSave.mockClear() // ignore the mount-time save

      await user.click(screen.getByRole('tab', { name: 'Stress Test' }))
      await user.click(screen.getByRole('tab', { name: 'Projection' }))
      await vi.advanceTimersByTimeAsync(350)

      expect(mockedSave).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
      vi.doUnmock('../storage')
      vi.resetModules()
    }
  })

  it('reset control asks for confirmation via an in-system dialog, and does nothing on decline', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    try {
      render(<PlanSection />)
      await user.click(screen.getByRole('tab', { name: 'Settings' }))
      const ageInput = screen.getByLabelText('Current age')
      await user.clear(ageInput)
      await user.type(ageInput, '50')
      await vi.advanceTimersByTimeAsync(350)
      expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull()

      await user.click(screen.getByRole('button', { name: 'Reset to defaults' }))

      const dialog = screen.getByRole('alertdialog')
      expect(dialog).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      expect(screen.getByLabelText('Current age')).toHaveValue('50')
      expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('PlanSection stock/bond allocation wiring (FIN-56)', () => {
  beforeEach(() => mockMatchMedia(true))
  afterEach(() => cleanup())

  it('passes the 70/30 default allocation to the stress test on mount', () => {
    render(<PlanSection />)

    const [, allocationArg] = lastOrchestrator.runCalls[0]
    expect(allocationArg).toEqual({ stocksPercent: 70, bondsPercent: 30 })
  })

  it('re-runs the stress test with the updated allocation after editing the Advanced assumptions field', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    try {
      render(<PlanSection />)
      await user.click(screen.getByRole('tab', { name: 'Settings' }))
      await user.click(screen.getByText('Advanced assumptions'))

      const allocationInput = screen.getByLabelText('Stock allocation (vs. bonds)')
      await user.clear(allocationInput)
      await user.type(allocationInput, '80')
      await vi.advanceTimersByTimeAsync(350)

      await user.click(screen.getByRole('tab', { name: 'Stress Test' }))
      await user.click(screen.getByRole('button', { name: /run stress test/i }))

      const lastCall = lastOrchestrator.runCalls.at(-1)
      expect(lastCall?.[1]).toEqual({ stocksPercent: 80, bondsPercent: 20 })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('PlanSection return assumption wiring (FIN-57, FIN-64)', () => {
  beforeEach(() => mockMatchMedia(true))
  afterEach(() => cleanup())

  it('always passes the engine default return assumptions to the stress test, not the Advanced assumptions fields', () => {
    render(<PlanSection />)

    const lastCall = lastOrchestrator.runCalls[0]
    expect(lastCall?.[4]).toEqual({ stocks: 0.115, bonds: 0.05 })
  })

  it('does not change the stress test return assumptions after editing the Advanced assumptions fields', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    try {
      render(<PlanSection />)
      await user.click(screen.getByRole('tab', { name: 'Settings' }))
      await user.click(screen.getByText('Advanced assumptions'))

      const stockReturnInput = screen.getByLabelText('Stock return assumption')
      await user.clear(stockReturnInput)
      await user.type(stockReturnInput, '9')
      const bondReturnInput = screen.getByLabelText('Bond return assumption')
      await user.clear(bondReturnInput)
      await user.type(bondReturnInput, '5.5')
      await vi.advanceTimersByTimeAsync(350)

      await user.click(screen.getByRole('tab', { name: 'Stress Test' }))
      await user.click(screen.getByRole('button', { name: /run stress test/i }))

      const lastCall = lastOrchestrator.runCalls.at(-1)
      expect(lastCall?.[4]).toEqual({ stocks: 0.115, bonds: 0.05 })
    } finally {
      vi.useRealTimers()
    }
  })
})
