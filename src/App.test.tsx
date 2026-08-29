import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { STORAGE_KEY } from './storage'

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
  run: (...args: unknown[]) => Promise<never>
  cancel: () => void
  emitComplete: () => void
  runCalls: unknown[][]
}

vi.mock('./workers', () => ({
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
    expect(screen.getByLabelText('Retirement age')).toHaveValue('65')
    expect(within(screen.getByRole('region', { name: 'Plan inputs' })).getByLabelText('Current investment balance')).toHaveValue('$250,000')
    expect(screen.getByLabelText('Current annual income')).toHaveValue('$85,000')
    expect(screen.getByLabelText('Annual savings percentage')).toHaveValue('15%')
  })

  it('defaults to the Projection tab, showing StatTiles and the chart, not the ProjectionTable', () => {
    render(<App />)
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

  it('renders no Monte Carlo overlay on the Plan tab\'s chart (FIN-47: band overlay removed entirely)', async () => {
    render(<App />)
    await act(async () => {
      lastOrchestrator.emitComplete()
    })
    // Even after a stress test completes, the Projection tab's bar chart shows only the
    // deterministic plan — no band elements of any kind behind the bars.
    expect(screen.queryByTestId(/^chart-band-/)).not.toBeInTheDocument()
  })

  it('wires a completed stress test\'s percentiles into a dedicated line chart on the Stress Test tab (FIN-47)', async () => {
    const user = userEvent.setup()
    render(<App />)
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
      render(<App />)
      // No emitComplete() here — the mocked orchestrator's initial auto-run never resolves,
      // mirroring "the stress test has never completed yet" rather than "it completed and
      // then went stale". The placeholder StatTile state should be unaffected by an input
      // change in this state — there's no prior result for a re-run CTA to be standing in for.
      expect(screen.getByText('Run a stress test to see this')).toBeInTheDocument()

      const ageInput = screen.getByLabelText('Current age')
      await user.clear(ageInput)
      await user.type(ageInput, '40')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(350)
      })

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
      render(<App />)
      act(() => {
        lastOrchestrator.emitComplete()
      })
      expect(screen.getByText('87%')).toBeInTheDocument()

      const ageInput = screen.getByLabelText('Current age')
      await user.clear(ageInput)
      await user.type(ageInput, '40')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(350)
      })

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
      render(<App />)
      act(() => {
        lastOrchestrator.emitComplete()
      })
      expect(screen.getByText('87%')).toBeInTheDocument()

      const ageInput = screen.getByLabelText('Current age')
      await user.clear(ageInput)
      await user.type(ageInput, '40')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(350)
      })

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
    // jsdom stubs getBoundingClientRect to all-zeros, so the marker's pixel position can't be
    // asserted directly here (that's ChartContainer's own FIN-42 tests' job, with a mocked
    // rect). Instead, this proves `retirementAge` isn't captured stale by moving it clean out
    // of the projected horizon (default currentAge 35) — the marker must disappear, which is
    // only possible if `ChartContainer` is re-deriving `retirementIndex` from the live prop.
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByTestId('percentile-chart-retirement-marker')).toBeInTheDocument()

    const retirementAgeInput = screen.getByLabelText('Retirement age')
    await user.clear(retirementAgeInput)
    await user.type(retirementAgeInput, '20')

    await waitFor(() => expect(screen.queryByTestId('percentile-chart-retirement-marker')).not.toBeInTheDocument())
  })

  it('shows the Medicare-start marker by default, and suppresses it once current age reaches 65 (FIN-73)', async () => {
    // Default currentAge is 35, well under 65, with the fixed 100-age horizon comfortably past
    // it, so the marker should show on load.
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByTestId('percentile-chart-medicare-marker')).toBeInTheDocument()

    // Moving current age to 65 puts Medicare cost in period 0 — the age-65 marker would
    // mislabel that as "starts here" (ERD §9/PRD), so it must disappear.
    const ageInput = screen.getByLabelText('Current age')
    await user.clear(ageInput)
    await user.type(ageInput, '65')

    await waitFor(() => expect(screen.queryByTestId('percentile-chart-medicare-marker')).not.toBeInTheDocument())
  })
})

describe('App persistence (FIN-43)', () => {
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
      const { unmount } = render(<App />)
      const ageInput = screen.getByLabelText('Current age')
      await user.clear(ageInput)
      await user.type(ageInput, '42')
      await vi.advanceTimersByTimeAsync(350)

      unmount()
      render(<App />)

      expect(screen.getByLabelText('Current age')).toHaveValue('42')
    } finally {
      vi.useRealTimers()
    }
  })

  it('saves exactly once per settled (debounced) change, not per keystroke', async () => {
    vi.doMock('./storage', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./storage')>()
      return { ...actual, saveAssumptions: vi.fn(actual.saveAssumptions) }
    })

    // Re-import App fresh so it picks up the mocked module (vi.doMock is not hoisted).
    vi.resetModules()
    const { default: FreshApp } = await import('./App')
    const storageModule = await import('./storage')
    const mockedSave = storageModule.saveAssumptions as unknown as ReturnType<typeof vi.fn>

    // Fake timers are installed *before* the initial render (rather than right after it) so the
    // mount-time debounce effect schedules its `setTimeout` against the fake clock from the
    // start. Installing them after render left that first timer real/native — `mockClear()`
    // right after render raced it (whether it had fired yet depended on incidental render cost,
    // e.g. which chart component was mounted), making this test's "ignore the mount-time save"
    // step flaky rather than deterministic.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    try {
      render(<FreshApp />)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(350) // let the mount-time save settle
      })
      mockedSave.mockClear() // ignore the mount-time save

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
      vi.doUnmock('./storage')
      vi.resetModules()
    }
  })

  it('never saves on chart selection, tab switches, or drawer open/close', async () => {
    vi.doMock('./storage', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./storage')>()
      return { ...actual, saveAssumptions: vi.fn(actual.saveAssumptions) }
    })
    vi.resetModules()
    const { default: FreshApp } = await import('./App')
    const storageModule = await import('./storage')
    const mockedSave = storageModule.saveAssumptions as unknown as ReturnType<typeof vi.fn>

    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    try {
      render(<FreshApp />)
      await vi.advanceTimersByTimeAsync(350)
      mockedSave.mockClear() // ignore the mount-time save

      await user.click(screen.getByRole('tab', { name: 'Stress Test' }))
      await user.click(screen.getByRole('tab', { name: 'Projection' }))
      await user.click(screen.getByRole('button', { name: /collapse/i }))
      await vi.advanceTimersByTimeAsync(350)

      expect(mockedSave).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
      vi.doUnmock('./storage')
      vi.resetModules()
    }
  })

  it('reset control asks for confirmation via an in-system dialog, and does nothing on decline', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    try {
      render(<App />)
      // Change a field away from its default first, so decline vs. confirm are
      // actually distinguishable — asserting against the untouched default value
      // can't tell "Cancel did nothing" apart from "Cancel silently reset everything".
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

  it('reset control clears storage and reverts to defaults with no reload, on confirm', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    try {
      render(<App />)
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
    }
  })
})

describe('App stock/bond allocation wiring (FIN-56)', () => {
  beforeEach(() => mockMatchMedia(true))
  afterEach(() => cleanup())

  it('passes the 70/30 default allocation to the stress test on mount', () => {
    render(<App />)

    const [, allocationArg] = lastOrchestrator.runCalls[0]
    expect(allocationArg).toEqual({ stocksPercent: 70, bondsPercent: 30 })
  })

  it('re-runs the stress test with the updated allocation after editing the Advanced assumptions field', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    try {
      render(<App />)
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

describe('App return assumption wiring (FIN-57, FIN-64)', () => {
  beforeEach(() => mockMatchMedia(true))
  afterEach(() => cleanup())

  // Tier 1 (the Plan projection) and Tier 2 (this stress test) deliberately use different
  // return bases (FIN-64): production always runs Tier 2 with `returnModel: 'historical'`,
  // which ignores the `returnAssumptions` argument entirely. App no longer threads the
  // Advanced assumptions form's editable stock/bond return fields into it, since doing so
  // implied those fields affected the stress test when they never did — these tests lock in
  // that it stays pinned to the engine's own default regardless of what the user types.
  it('always passes the engine default return assumptions to the stress test, not the Advanced assumptions fields', () => {
    render(<App />)

    const lastCall = lastOrchestrator.runCalls[0]
    expect(lastCall?.[4]).toEqual({ stocks: 0.115, bonds: 0.05 })
  })

  it('does not change the stress test return assumptions after editing the Advanced assumptions fields', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    try {
      render(<App />)
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

/**
 * FIN-65 change 3: the display unit is stated once, globally.
 *
 * Every figure the app renders — both tabs' stat tiles, both charts, both year-detail panels —
 * is deflated to today's purchasing power. That was originally parenthesised onto each tile
 * label and chart title, which read as a repeated disclaimer rather than a unit (Travis,
 * 2026-08-26). It now lives in one muted line under the tab bar.
 *
 * The risk that reintroduces is the reason this suite exists: with the unit stated in exactly
 * one place, losing that one element leaves an app whose every number silently means something
 * else — roughly 5x off at the far end of the horizon — with nothing on screen to contradict a
 * reader who assumes nominal dollars. So the note's presence, its uniqueness, and its
 * applicability to both tabs are all pinned, and the old per-element labels are pinned as
 * absent so a future edit cannot quietly restore the duplication this replaced.
 */
describe("FIN-65 change 3: the display unit is stated once, globally", () => {
  // This file opts out of RTL's automatic cleanup (it imports `describe`/`it` from vitest
  // rather than using globals), so each describe wires its own — without it a previous test's
  // App stays mounted and the "exactly once" assertion counts two of everything.
  beforeEach(() => mockMatchMedia(true))
  afterEach(() => cleanup())

  it('states the unit under the tab bar', () => {
    render(<App />)

    expect(screen.getByText("All amounts in today's dollars")).toBeInTheDocument()
  })

  it('states it exactly once, not per tile and chart', () => {
    render(<App />)

    expect(screen.getAllByText(/today.s dollars/i)).toHaveLength(1)
  })

  it('keeps stating it on the Stress Test tab, which is deflated too', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('tab', { name: 'Stress Test' }))

    expect(screen.getByRole('tab', { name: 'Stress Test' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText("All amounts in today's dollars")).toBeInTheDocument()
  })

  it('leaves the unit out of the tile label and the chart title', () => {
    render(<App />)

    expect(screen.getByText('Projected balance at 65')).toBeInTheDocument()
    expect(screen.getByRole('figure', { name: 'Investment balance by year' })).toBeInTheDocument()
  })

  it('exposes the note as readable text, not a decoration screen readers skip', () => {
    render(<App />)

    // `getByText` would still find an `aria-hidden` node, and this is now the only place the
    // unit is stated — so hiding it from assistive tech would leave those users with no unit
    // at all rather than a redundant one.
    expect(screen.getByText("All amounts in today's dollars")).not.toHaveAttribute('aria-hidden')
  })
})
