import { useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_VOLATILITY_ASSUMPTIONS } from '../../../engine'
import type { PlanAssumptions, PortfolioAllocation } from '../../../engine'
import { createMonteCarloOrchestrator } from '../../../workers'
import type { MonteCarloOrchestrator, StressTestState } from '../../../workers'
import { formatPercent } from '../../utils/format'
import { Button } from '../Button/Button'
import styles from './StressTestSection.module.css'

/**
 * FIN-14/FIN-8: 70% stocks / 30% bonds, hardcoded for the MVP — neither ticket makes
 * allocation user-configurable yet.
 */
const DEFAULT_ALLOCATION: PortfolioAllocation = { stocksPercent: 70, bondsPercent: 30 }

interface StressTestSectionProps {
  /** The plan inputs to stress-test. Changing this cancels any in-flight run (FIN-14 AC). */
  assumptions: PlanAssumptions
  /**
   * Test-only seam: substitute a fake `MonteCarloOrchestrator` instead of the real
   * Worker-backed one, mirroring the `runPeriodFn`/`WorkerFactory` injection seams elsewhere
   * in this codebase. Defaults to a fresh real orchestrator per mounted component.
   */
  orchestrator?: MonteCarloOrchestrator
  /**
   * FIN-26 integration seam: called whenever the computed success rate changes (including
   * back to `null`, e.g. on a fresh orchestrator), so a parent (`App.tsx`) can surface it in
   * a `StatTile` without this component needing to know anything about tabs/layout. Optional
   * and additive — omitting it changes nothing about StressTestSection's own rendering.
   */
  onSuccessRateChange?: (successRate: number | null) => void
}

export function StressTestSection({
  assumptions,
  orchestrator: injectedOrchestrator,
  onSuccessRateChange,
}: StressTestSectionProps) {
  const orchestrator = useMemo(() => injectedOrchestrator ?? createMonteCarloOrchestrator(), [injectedOrchestrator])
  const [state, setState] = useState<StressTestState>(() => orchestrator.getState())
  const [successRate, setSuccessRate] = useState<number | null>(null)
  const isFirstRender = useRef(true)

  useEffect(() => {
    const unsubscribe = orchestrator.subscribe(setState)
    return unsubscribe
  }, [orchestrator])

  useEffect(() => {
    if (state.status === 'complete') {
      setSuccessRate(state.result.successRate)
    }
  }, [state])

  useEffect(() => {
    onSuccessRateChange?.(successRate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [successRate])

  // Cancel-on-input-change (FIN-14 AC): keyed on `assumptions` changing, but must not fire on
  // the initial mount — there is nothing in flight to cancel yet.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    orchestrator.cancel()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assumptions])

  const handleRunClick = () => {
    orchestrator.run(assumptions, DEFAULT_ALLOCATION, DEFAULT_VOLATILITY_ASSUMPTIONS).catch(() => {
      // Intentionally ignored: the orchestrator's `subscribe` callback already syncs `state`
      // to `cancelled`/`error` for both rejection paths (cancellation and worker failure).
      // This catch exists solely to prevent an unhandled promise rejection.
    })
  }

  const isRunning = state.status === 'running'
  const buttonLabel = isRunning ? 'Running stress test...' : 'Run stress test'

  return (
    <section className={styles.section}>
      <Button onClick={handleRunClick} disabled={isRunning}>
        {buttonLabel}
      </Button>

      {state.status === 'cancelled' && (
        <output className={styles.cancelledMessage}>Cancelled — click to re-run</output>
      )}

      {state.status === 'error' && (
        <p className={styles.errorMessage} role="alert">
          Something went wrong running the stress test — click to try again
        </p>
      )}

      <p className={styles.successRate}>
        Success rate: {successRate === null ? '[Run stress test to see results]' : formatPercent(successRate)}
      </p>
    </section>
  )
}
