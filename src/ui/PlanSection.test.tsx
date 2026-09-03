import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanSection } from './PlanSection'
import { STORAGE_KEY } from '../storage'
import * as useProjectionStateModule from './hooks/useProjectionState'

// FIN-114 follow-up: useProjectionState gained a `people` param so it can derive a spouse and
// include `spouseMedicarePartBEvent`, but nothing verified PlanSection actually passed its real
// `people` state through — it was calling the hook with only 3 args, so the spousal event was
// silently never included in the live plan regardless of what a user entered on the People tab.
// Spying (not mocking) the real hook lets this test assert on the actual call args it receives.
vi.spyOn(useProjectionStateModule, 'useProjectionState')

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
// Profile tab that replaced the old Drawer).
describe('PlanSection', () => {
  beforeEach(() => mockMatchMedia(true))
  afterEach(() => cleanup())

  it('renders its own TabBar with Projection, Stress Test, and Profile tabs', () => {
    render(<PlanSection />)
    expect(screen.getByRole('tablist', { name: 'Views' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Projection' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Stress Test' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Profile' })).toBeInTheDocument()
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

  // FIN-114 follow-up: adding a spouse via the People tab must actually reach
  // useProjectionState's `people` param, since that's what lets it derive a spouse and include
  // spouseMedicarePartBEvent in the real, rendered plan. Asserts on the hook's real call args
  // (see the `vi.spyOn` above) rather than on projection output, since a spouse's Medicare
  // event doesn't move any currently-asserted-on number by itself.
  it('passes the current People list into useProjectionState, so a spouse reaches the projection', async () => {
    const user = userEvent.setup()
    render(<PlanSection />)

    await user.click(screen.getByRole('tab', { name: 'Profile' }))
    await user.click(screen.getByRole('tab', { name: 'People' }))
    await user.click(screen.getByRole('button', { name: '+ Spouse' }))

    await waitFor(() => {
      const lastCall = vi.mocked(useProjectionStateModule.useProjectionState).mock.calls.at(-1)
      const peopleArg = lastCall?.[3]
      expect(peopleArg?.some((person) => !person.isPrimary)).toBe(true)
    })
  })

  // FIN-121: closes the coverage gap the peer review flagged — the FIN-114 test above only
  // asserts the spouse reaches `useProjectionState`'s `people` param, not that it actually
  // produces a visible chart marker. Real (unmocked) projection output, since the marker only
  // appears once `PlanSection` derives `spouseMedicareStartAge` from `events` and confirms it
  // lands on a plotted row.
  it('shows a spouse Medicare-start marker once a spouse is added via the People tab', async () => {
    // Unlike the rest of this describe block, this test's `waitFor` runs long enough for FIN-43's
    // persistence effect to actually fire and write the added spouse to `localStorage` — which
    // would otherwise leak into every later test in this file, since this top-level describe
    // (unlike "PlanSection persistence (FIN-43)" below) never stubs it. Stub it for just this one
    // test rather than the whole block, to keep this a one-test fix.
    vi.stubGlobal('localStorage', createFakeStorage())
    const user = userEvent.setup()
    render(<PlanSection />)

    expect(screen.queryByTestId('percentile-chart-spouse-medicare-marker')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Profile' }))
    await user.click(screen.getByRole('tab', { name: 'People' }))
    await user.click(screen.getByRole('button', { name: '+ Spouse' }))
    await user.click(screen.getByRole('tab', { name: 'Projection' }))

    await waitFor(() => expect(screen.getByTestId('percentile-chart-spouse-medicare-marker')).toBeInTheDocument())
    vi.unstubAllGlobals()
  })

  // FIN-116 follow-up: the primary Person's age/retirementAge fields on the People tab used to
  // be fully decoupled from the engine — editing them there silently did nothing to the
  // projection, since useProjectionState only ever read coreValues.currentAge/retirementAge and
  // CoreInputsForm's own (separate) age/retirement fields were what actually drove the plan.
  // `syncCoreWithPrimary` fixed this by feeding the primary Person's values into the
  // `effectiveCoreValues` used everywhere downstream. This asserts the fix end-to-end: editing
  // age via the People tab's "Current age" field changes the "Projected balance at N" tile's
  // retirement age, proving the edit actually reached useProjectionState's assumptions.
  it('reflects an age edit made via the People tab in the projection (age is no longer decoupled from the engine)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    try {
      render(<PlanSection />)
      expect(screen.getByText('Projected balance at 65')).toBeInTheDocument()

      await user.click(screen.getByRole('tab', { name: 'Profile' }))
      const retirementAgeInput = screen.getByLabelText('Retirement age')
      await user.clear(retirementAgeInput)
      await user.type(retirementAgeInput, '70')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(350)
      })

      await user.click(screen.getByRole('tab', { name: 'Projection' }))
      expect(screen.getByText('Projected balance at 70')).toBeInTheDocument()
      expect(screen.queryByText('Projected balance at 65')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  // FIN-116 follow-up: CoreInputsForm used to render its own "Current age"/"Retirement age"
  // fields directly below PeopleTab's identically-labeled fields in the same tab panel — a
  // real duplicate-field bug (not just an accessible-name collision), since both were editable
  // and could drift independently. CoreInputsForm no longer renders those two fields at all;
  // this guards against either field being reintroduced there.
  it('renders "Current age" and "Retirement age" exactly once each on the Profile tab (no duplicate fields)', async () => {
    const user = userEvent.setup()
    render(<PlanSection />)
    await user.click(screen.getByRole('tab', { name: 'Profile' }))

    expect(screen.getAllByLabelText('Current age')).toHaveLength(1)
    expect(screen.getAllByLabelText('Retirement age')).toHaveLength(1)
  })

  // FIN-116 follow-up (2nd pass): the same decoupling bug also applied to salary —
  // `Person.salary` and `CoreInputValues.currentAnnualIncome` are the same concept
  // (`createPrimaryPerson` already seeds `salary: core.currentAnnualIncome`), but
  // CoreInputsForm kept rendering its own independently-editable "Current annual income"
  // field below PeopleTab's "Salary" field. `syncCoreWithPrimary` now overrides
  // `currentAnnualIncome` from the primary Person's `salary` too, and CoreInputsForm no
  // longer renders that field at all.
  it('reflects a salary edit made via the People tab in the projection, with no duplicate income field', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    try {
      render(<PlanSection />)
      await user.click(screen.getByRole('tab', { name: 'Profile' }))

      // No independently-editable "Current annual income" field left on CoreInputsForm.
      expect(screen.queryByLabelText('Current annual income')).not.toBeInTheDocument()
      expect(screen.getAllByLabelText('Salary')).toHaveLength(1)

      const balanceBefore = screen.getByText(/Projected balance at/).parentElement?.textContent

      const salaryInput = screen.getByLabelText('Salary')
      await user.clear(salaryInput)
      await user.type(salaryInput, '250000')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(350)
      })

      await user.click(screen.getByRole('tab', { name: 'Projection' }))
      const balanceAfter = screen.getByText(/Projected balance at/).parentElement?.textContent
      expect(balanceAfter).not.toEqual(balanceBefore)
    } finally {
      vi.useRealTimers()
    }
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

      await user.click(screen.getByRole('tab', { name: 'Profile' }))
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

      await user.click(screen.getByRole('tab', { name: 'Profile' }))
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

      await user.click(screen.getByRole('tab', { name: 'Profile' }))
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

    await user.click(screen.getByRole('tab', { name: 'Profile' }))
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

    await user.click(screen.getByRole('tab', { name: 'Profile' }))
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

describe('PlanSection Profile tab (FIN-98/FIN-88: replaces the Drawer)', () => {
  beforeEach(() => mockMatchMedia(true))
  afterEach(() => cleanup())

  it('shows Core Inputs and a reset button, full-width, with no leftover Drawer affordance', async () => {
    const user = userEvent.setup()
    render(<PlanSection />)

    await user.click(screen.getByRole('tab', { name: 'Profile' }))
    expect(screen.getByRole('tab', { name: 'Profile' })).toHaveAttribute('aria-selected', 'true')

    expect(screen.getByLabelText('Current age')).toBeInTheDocument()
    expect(screen.getByLabelText('Retirement age')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset to defaults' })).toBeInTheDocument()

    // FIN-119: Advanced Assumptions moved to the Rates sub-tab, not shown under People anymore.
    expect(screen.queryByLabelText('Stock allocation (vs. bonds)')).not.toBeInTheDocument()

    // The old Drawer's open/collapse toggle is gone entirely.
    expect(screen.queryByRole('button', { name: /collapse/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /expand/i })).not.toBeInTheDocument()
  })

  it('reflects a value changed in Profile once switched to Projection', async () => {
    const user = userEvent.setup()
    render(<PlanSection />)

    await user.click(screen.getByRole('tab', { name: 'Profile' }))
    // FIN-117 bug-fix round: initialBalance now lives on the primary's seeded default Account,
    // edited via the Accounts sub-tab rather than the (now-removed) CoreInputsForm.
    await user.click(within(screen.getByRole('navigation', { name: 'Profile sections' })).getByRole('button', { name: 'Accounts' }))
    const balanceInput = screen.getByRole('textbox', { name: 'Balance' })
    await user.clear(balanceInput)
    await user.type(balanceInput, '500000')

    await user.click(screen.getByRole('tab', { name: 'Projection' }))
    expect(screen.getByRole('region', { name: 'Current investment balance' })).toHaveTextContent('$500,000')
  })

  it('FIN-129: sums balances across every primary-owned account, not just the first', async () => {
    const user = userEvent.setup()
    render(<PlanSection />)

    await user.click(screen.getByRole('tab', { name: 'Profile' }))
    await user.click(within(screen.getByRole('navigation', { name: 'Profile sections' })).getByRole('button', { name: 'Accounts' }))

    const firstBalanceInput = screen.getByRole('textbox', { name: 'Balance' })
    await user.clear(firstBalanceInput)
    await user.type(firstBalanceInput, '300000')

    // "+ Account" defaults the new account's owner to the first Person, which is the primary —
    // see AccountsTab's `handleAddAccount`.
    await user.click(screen.getByRole('button', { name: '+ Account' }))
    const balanceInputs = screen.getAllByRole('textbox', { name: 'Balance' })
    expect(balanceInputs).toHaveLength(2)
    await user.clear(balanceInputs[1])
    await user.type(balanceInputs[1], '200000')

    await user.click(screen.getByRole('tab', { name: 'Projection' }))
    expect(screen.getByRole('region', { name: 'Current investment balance' })).toHaveTextContent('$500,000')
  })

  it('clicking Reset from Profile triggers the existing reset confirmation flow', async () => {
    const user = userEvent.setup()
    render(<PlanSection />)

    await user.click(screen.getByRole('tab', { name: 'Profile' }))
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
      await user.click(screen.getByRole('tab', { name: 'Profile' }))
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

describe('PlanSection Profile nav shell (FIN-115: People/Accounts/Rates)', () => {
  beforeEach(() => mockMatchMedia(true))
  afterEach(() => cleanup())

  it('shows a left-hand nav with People, Accounts, and Rates, defaulting to People', async () => {
    const user = userEvent.setup()
    render(<PlanSection />)

    await user.click(screen.getByRole('tab', { name: 'Profile' }))

    const nav = screen.getByRole('navigation', { name: 'Profile sections' })
    expect(within(nav).getByRole('button', { name: 'People' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('button', { name: 'Accounts' })).not.toHaveAttribute('aria-current')
    expect(within(nav).getByRole('button', { name: 'Rates' })).not.toHaveAttribute('aria-current')

    // People is the default sub-tab, so its content (the input forms) is already showing.
    expect(screen.getByLabelText('Current age')).toBeInTheDocument()
  })

  it('also renders a mobile tab strip (TabBar semantics) for the same People/Accounts/Rates switch', async () => {
    const user = userEvent.setup()
    render(<PlanSection />)

    await user.click(screen.getByRole('tab', { name: 'Profile' }))

    const strip = screen.getByRole('tablist', { name: 'Profile sections' })
    expect(within(strip).getByRole('tab', { name: 'People' })).toHaveAttribute('aria-selected', 'true')
    expect(within(strip).getByRole('tab', { name: 'Accounts' })).toHaveAttribute('aria-selected', 'false')
    expect(within(strip).getByRole('tab', { name: 'Rates' })).toHaveAttribute('aria-selected', 'false')
  })

  it('switches to the real Accounts tab when Accounts is selected from the desktop nav', async () => {
    const user = userEvent.setup()
    render(<PlanSection />)

    await user.click(screen.getByRole('tab', { name: 'Profile' }))
    const nav = screen.getByRole('navigation', { name: 'Profile sections' })
    await user.click(within(nav).getByRole('button', { name: 'Accounts' }))

    expect(screen.getByRole('button', { name: '+ Account' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Current age')).not.toBeInTheDocument()
  })

  it('shows the Advanced Assumptions form (titled by its own "Rates" heading) on the Rates sub-tab (FIN-119), and no longer under People', async () => {
    const user = userEvent.setup()
    render(<PlanSection />)

    await user.click(screen.getByRole('tab', { name: 'Profile' }))
    // People (the default sub-tab) no longer renders Advanced Assumptions.
    expect(screen.queryByLabelText('Stock allocation (vs. bonds)')).not.toBeInTheDocument()

    const nav = screen.getByRole('navigation', { name: 'Profile sections' })
    await user.click(within(nav).getByRole('button', { name: 'Rates' }))

    expect(screen.queryByText('Coming soon.')).not.toBeInTheDocument()
    // FIN-119 follow-up: no "Advanced assumptions" text anywhere — the CollapsibleSection
    // summary that used to provide it is gone. The panel's own heading matches its nav label
    // ("Rates"), the same pattern PeopleTab/AccountsTab already use for their own headings.
    expect(screen.queryByText('Advanced assumptions')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Rates', level: 3 })).toBeInTheDocument()
    expect(screen.getByLabelText('Stock allocation (vs. bonds)')).toBeInTheDocument()
  })

  it('persists the selected Profile sub-tab across switching away to another top-level tab and back', async () => {
    const user = userEvent.setup()
    render(<PlanSection />)

    await user.click(screen.getByRole('tab', { name: 'Profile' }))
    const nav = screen.getByRole('navigation', { name: 'Profile sections' })
    await user.click(within(nav).getByRole('button', { name: 'Accounts' }))

    await user.click(screen.getByRole('tab', { name: 'Projection' }))
    await user.click(screen.getByRole('tab', { name: 'Profile' }))

    expect(within(screen.getByRole('navigation', { name: 'Profile sections' })).getByRole('button', { name: 'Accounts' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('button', { name: '+ Account' })).toBeInTheDocument()
  })

  it('keeps the desktop nav and mobile strip in sync — selecting from one updates the other', async () => {
    const user = userEvent.setup()
    render(<PlanSection />)

    await user.click(screen.getByRole('tab', { name: 'Profile' }))
    const strip = screen.getByRole('tablist', { name: 'Profile sections' })
    await user.click(within(strip).getByRole('tab', { name: 'Rates' }))

    const nav = screen.getByRole('navigation', { name: 'Profile sections' })
    expect(within(nav).getByRole('button', { name: 'Rates' })).toHaveAttribute('aria-current', 'page')
  })

  it('renders an icon per item on both the desktop nav and the mobile strip', async () => {
    const user = userEvent.setup()
    render(<PlanSection />)

    await user.click(screen.getByRole('tab', { name: 'Profile' }))

    const nav = screen.getByRole('navigation', { name: 'Profile sections' })
    expect(within(nav).getByRole('button', { name: 'People' }).querySelector('svg')).toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: 'Accounts' }).querySelector('svg')).toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: 'Rates' }).querySelector('svg')).toBeInTheDocument()

    const strip = screen.getByRole('tablist', { name: 'Profile sections' })
    expect(within(strip).getByRole('tab', { name: 'People' }).querySelector('svg')).toBeInTheDocument()
    expect(within(strip).getByRole('tab', { name: 'Accounts' }).querySelector('svg')).toBeInTheDocument()
    expect(within(strip).getByRole('tab', { name: 'Rates' }).querySelector('svg')).toBeInTheDocument()
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

  it('moves focus to the Profile heading when switching to that tab', async () => {
    const user = userEvent.setup()
    render(<PlanSection />)

    await user.click(screen.getByRole('tab', { name: 'Profile' }))

    expect(screen.getByRole('heading', { name: 'Profile' })).toHaveFocus()
  })

  it('moves focus back to the Projection heading when switching back', async () => {
    const user = userEvent.setup()
    render(<PlanSection />)

    await user.click(screen.getByRole('tab', { name: 'Profile' }))
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
    // Real timers + waitFor on the actual persisted value, rather than fake timers advanced
    // by a fixed margin: `vi.useFakeTimers({ shouldAdvanceTime: true })` ties the fake clock's
    // auto-advance to real wall-clock time elapsed during `user.type()`, which made this test's
    // outcome depend on how fast the runner executing it was — it flaked consistently on CI's
    // shared runners (received the default age — the debounced save hadn't fired) while never
    // reproducing locally, even after widening the post-typing advance from 350ms to 500ms.
    // Polling the real debounced save with `waitFor` removes that coupling entirely.
    const user = userEvent.setup()
    const { unmount } = render(<PlanSection />)
    await user.click(screen.getByRole('tab', { name: 'Profile' }))
    const ageInput = screen.getByLabelText('Current age')
    await user.clear(ageInput)
    await user.type(ageInput, '42')

    await waitFor(() => {
      const raw = localStorage.getItem(STORAGE_KEY)
      expect(raw).not.toBeNull()
      expect(JSON.parse(raw as string).core.currentAge).toBe(42)
    })

    unmount()
    render(<PlanSection />)
    await user.click(screen.getByRole('tab', { name: 'Profile' }))

    expect(screen.getByLabelText('Current age')).toHaveValue('42')
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

      await user.click(screen.getByRole('tab', { name: 'Profile' }))
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
      await user.click(screen.getByRole('tab', { name: 'Profile' }))
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
      await user.click(screen.getByRole('tab', { name: 'Profile' }))
      await user.click(within(screen.getByRole('navigation', { name: 'Profile sections' })).getByRole('button', { name: 'Rates' }))

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
      await user.click(screen.getByRole('tab', { name: 'Profile' }))
      await user.click(within(screen.getByRole('navigation', { name: 'Profile sections' })).getByRole('button', { name: 'Rates' }))

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

describe('PlanSection cascade account cleanup (FIN-117 PM/Eng addendum round 2)', () => {
  beforeEach(() => mockMatchMedia(true))
  afterEach(() => cleanup())

  it('removes a spouse\'s account when the spouse is removed via the cascade-confirm dialog', async () => {
    const user = userEvent.setup()
    render(<PlanSection />)

    await user.click(screen.getByRole('tab', { name: 'Profile' }))
    const nav = screen.getByRole('navigation', { name: 'Profile sections' })

    // Add a spouse from the People sub-tab (the default).
    await user.click(screen.getByRole('button', { name: '+ Spouse' }))

    // Give the spouse an account from the Accounts sub-tab.
    await user.click(within(nav).getByRole('button', { name: 'Accounts' }))
    await user.click(screen.getByRole('button', { name: '+ Account' }))
    const ownerSelects = screen.getAllByLabelText('Owner')
    const spouseAccountOwnerSelect = ownerSelects[ownerSelects.length - 1]
    await user.click(spouseAccountOwnerSelect)
    await user.click(screen.getByRole('option', { name: 'Spouse' }))
    expect(screen.getAllByLabelText('Balance')).toHaveLength(2)

    // Remove the spouse from the People sub-tab — this fires the cascade-confirm dialog since
    // the spouse now owns an account (`spouseHasAccounts`).
    await user.click(within(nav).getByRole('button', { name: 'People' }))
    await user.click(screen.getByRole('button', { name: 'Remove spouse' }))
    expect(screen.getByText('Remove spouse?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove' }))

    // Back on the Accounts sub-tab, only the primary's original seeded account remains — the
    // spouse's account was cleaned up along with the spouse.
    await user.click(within(nav).getByRole('button', { name: 'Accounts' }))
    expect(screen.getAllByLabelText('Balance')).toHaveLength(1)
  })
})
