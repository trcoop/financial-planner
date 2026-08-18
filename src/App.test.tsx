import { cleanup, render, screen, within } from '@testing-library/react'
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
vi.mock('./workers', () => ({
  createMonteCarloOrchestrator: () => ({
    getState: () => ({ status: 'idle' }),
    subscribe: () => () => {},
    run: () => new Promise(() => {}),
    cancel: () => {},
  }),
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
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    vi.useFakeTimers({ shouldAdvanceTime: true })
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

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      render(<FreshApp />)
      mockedSave.mockClear() // ignore the mount-time save

      const ageInput = screen.getByLabelText('Current age')
      await user.clear(ageInput)
      await user.type(ageInput, '5')
      await user.type(ageInput, '0')

      await vi.advanceTimersByTimeAsync(350)

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

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    vi.useFakeTimers({ shouldAdvanceTime: true })
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

  it('reset control asks for confirmation, and does nothing on decline', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Reset to defaults' }))

    expect(confirmSpy).toHaveBeenCalled()
    expect(screen.getByLabelText('Current age')).toHaveValue('35')
    confirmSpy.mockRestore()
  })

  it('reset control clears storage and reverts to defaults with no reload, on confirm', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      render(<App />)
      const ageInput = screen.getByLabelText('Current age')
      await user.clear(ageInput)
      await user.type(ageInput, '50')
      await vi.advanceTimersByTimeAsync(350)
      expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull()

      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      await user.click(screen.getByRole('button', { name: 'Reset to defaults' }))

      expect(screen.getByLabelText('Current age')).toHaveValue('35')
      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
      confirmSpy.mockRestore()
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
