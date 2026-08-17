import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import type { PlanAssumptions } from '../../../engine'
import type { MonteCarloOrchestrator, StressTestState } from '../../../workers'
import { StressTestSection } from './StressTestSection'

const baseAssumptions: PlanAssumptions = {
  currentAge: 35,
  retirementAge: 67,
  initialBalance: 100_000,
  currentAnnualIncome: 80_000,
  annualContributionRate: 0.15,
  annualRaiseRate: 0.03,
  annualReturnRate: 0.07,
  inflationRate: 0.025,
  withdrawalRateInRetirement: 0.04,
  planningHorizonEndAge: 100,
}

const fakeResult = {
  successRate: 87,
  percentiles: { p10: [1], p50: [2], p90: [3] },
  meta: { simulationCount: 1000, stockVolatility: 0.15, bondVolatility: 0.06, allocation: { stocks: 70, bonds: 30 } },
}

/**
 * A minimal, fully-controllable double for `MonteCarloOrchestrator`. Lets tests dictate
 * exactly when a run resolves/rejects, mirroring the pattern in
 * `src/workers/monteCarloOrchestrator.test.ts`.
 */
class FakeOrchestrator implements MonteCarloOrchestrator {
  private state: StressTestState = { status: 'idle' }
  private listeners = new Set<(state: StressTestState) => void>()
  private pendingResolve: ((result: typeof fakeResult) => void) | null = null
  private pendingReject: ((error: Error) => void) | null = null
  runCalls: unknown[][] = []
  cancelCalls = 0

  private setState(next: StressTestState) {
    this.state = next
    this.listeners.forEach((listener) => listener(next))
  }

  getState() {
    return this.state
  }

  subscribe(listener: (state: StressTestState) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  run(...args: unknown[]) {
    this.runCalls.push(args)
    this.setState({ status: 'running' })
    return new Promise<typeof fakeResult>((resolve, reject) => {
      this.pendingResolve = resolve
      this.pendingReject = reject
    })
  }

  cancel() {
    this.cancelCalls += 1
    if (this.state.status !== 'running') return
    this.setState({ status: 'cancelled' })
    this.pendingReject?.(new Error('cancelled'))
    this.pendingResolve = null
    this.pendingReject = null
  }

  resolveRun() {
    this.setState({ status: 'complete', result: fakeResult })
    this.pendingResolve?.(fakeResult)
    this.pendingResolve = null
    this.pendingReject = null
  }

  rejectRun(error: Error) {
    this.setState({ status: 'error', code: 'WORKER_CRASHED', message: error.message })
    this.pendingReject?.(error)
    this.pendingResolve = null
    this.pendingReject = null
  }
}

describe('StressTestSection', () => {
  afterEach(() => cleanup())

  it('shows the idle placeholder before the first run', () => {
    const orchestrator = new FakeOrchestrator()
    render(<StressTestSection assumptions={baseAssumptions} orchestrator={orchestrator} />)

    expect(screen.getByText('Success rate: [Run stress test to see results]')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run stress test' })).toBeEnabled()
  })

  it('runs the simulation with the default 70/30 allocation and default volatility on click', async () => {
    const user = userEvent.setup()
    const orchestrator = new FakeOrchestrator()
    render(<StressTestSection assumptions={baseAssumptions} orchestrator={orchestrator} />)

    await user.click(screen.getByRole('button', { name: 'Run stress test' }))

    expect(orchestrator.runCalls).toHaveLength(1)
    const [assumptionsArg, allocationArg] = orchestrator.runCalls[0]
    expect(assumptionsArg).toEqual(baseAssumptions)
    expect(allocationArg).toEqual({ stocksPercent: 70, bondsPercent: 30 })
  })

  it('shows a running/disabled state while a test is in flight', async () => {
    const user = userEvent.setup()
    const orchestrator = new FakeOrchestrator()
    render(<StressTestSection assumptions={baseAssumptions} orchestrator={orchestrator} />)

    await user.click(screen.getByRole('button', { name: 'Run stress test' }))

    const button = screen.getByRole('button', { name: /running stress test/i })
    expect(button).toBeDisabled()
  })

  it('shows the success rate once the run completes and returns the button to idle', async () => {
    const user = userEvent.setup()
    const orchestrator = new FakeOrchestrator()
    render(<StressTestSection assumptions={baseAssumptions} orchestrator={orchestrator} />)

    await user.click(screen.getByRole('button', { name: 'Run stress test' }))
    act(() => orchestrator.resolveRun())

    await waitFor(() => expect(screen.getByText('Success rate: 87%')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Run stress test' })).toBeEnabled()
  })

  it('cancels the in-flight run and shows a transient cancelled message when assumptions change', async () => {
    const user = userEvent.setup()
    const orchestrator = new FakeOrchestrator()
    const { rerender } = render(<StressTestSection assumptions={baseAssumptions} orchestrator={orchestrator} />)

    await user.click(screen.getByRole('button', { name: 'Run stress test' }))
    expect(orchestrator.cancelCalls).toBe(0)

    rerender(
      <StressTestSection
        assumptions={{ ...baseAssumptions, currentAnnualIncome: 90_000 }}
        orchestrator={orchestrator}
      />,
    )

    expect(orchestrator.cancelCalls).toBe(1)
    await waitFor(() => expect(screen.getByText(/cancelled.*click to re-run/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Run stress test' })).toBeEnabled()
  })

  it('does not cancel on the initial mount, only on a later assumptions change', () => {
    const orchestrator = new FakeOrchestrator()
    const { rerender } = render(<StressTestSection assumptions={baseAssumptions} orchestrator={orchestrator} />)
    rerender(<StressTestSection assumptions={baseAssumptions} orchestrator={orchestrator} />)

    expect(orchestrator.cancelCalls).toBe(0)
  })

  it('shows an error banner and resets the button when the run rejects', async () => {
    const user = userEvent.setup()
    const orchestrator = new FakeOrchestrator()
    render(<StressTestSection assumptions={baseAssumptions} orchestrator={orchestrator} />)

    await user.click(screen.getByRole('button', { name: 'Run stress test' }))
    act(() => orchestrator.rejectRun(new Error('boom')))

    await waitFor(() =>
      expect(screen.getByText(/something went wrong running the stress test/i)).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Run stress test' })).toBeEnabled()
  })

  it('allows running multiple stress tests in sequence', async () => {
    const user = userEvent.setup()
    const orchestrator = new FakeOrchestrator()
    render(<StressTestSection assumptions={baseAssumptions} orchestrator={orchestrator} />)

    await user.click(screen.getByRole('button', { name: 'Run stress test' }))
    act(() => orchestrator.resolveRun())
    await waitFor(() => expect(screen.getByText('Success rate: 87%')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Run stress test' }))
    expect(orchestrator.runCalls).toHaveLength(2)
  })
})
