import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { DEFAULT_RETURN_ASSUMPTIONS, DEFAULT_VOLATILITY_ASSUMPTIONS } from '../../../engine'
import type { PercentilePaths, PlanAssumptions, PortfolioAllocation, ReturnAssumptions } from '../../../engine'
import { createMonteCarloOrchestrator } from '../../../workers'
import type { MonteCarloOrchestrator, StressTestState } from '../../../workers'
import { formatCurrency, formatPercent } from '../../utils/format'
import { Button } from '../Button/Button'
import { Card } from '../Card/Card'
import type { ChartRow } from '../ChartContainer/types'
import { PercentileLineChart, type LineChartRow, type LineChartSeries } from '../PercentileLineChart/PercentileLineChart'
import styles from './StressTestSection.module.css'

/**
 * FIN-14/FIN-8's original 70/30 default, still used as the fallback when no `allocation` prop
 * is supplied. FIN-56 makes allocation user-configurable (`AdvancedAssumptionsForm`'s new
 * "Stock allocation" field, threaded down via `App.tsx`) — this constant now only covers
 * callers (and tests) that don't pass one.
 */
const DEFAULT_ALLOCATION: PortfolioAllocation = { stocksPercent: 70, bondsPercent: 30 }

/** The three percentile lines, ordered high-to-low so `PercentileLineChart`'s shading reads as
 * "p90 down to p50, p50 down to p10, p10 down to the chart bottom" (FIN-60). Colors come from
 * the shared theme rather than a chart-specific palette: p90 (best case) uses the "success"
 * green, p50 (expected case) uses the primary blue, p10 (worst case) uses the "warning" amber —
 * unchanged from FIN-47 in spirit (median was already the most prominent line) but now
 * expressed as distinct colors instead of dash/solid styling. */
const PERCENTILE_SERIES: LineChartSeries[] = [
  { key: 'p90', label: '90th percentile', color: 'var(--color-success)' },
  { key: 'p50', label: 'Median (50th percentile)', color: 'var(--color-primary)' },
  { key: 'p10', label: '10th percentile', color: 'var(--color-warning)' },
]

interface StressTestSectionProps {
  /** The plan inputs to stress-test. Changing this cancels any in-flight run (FIN-14 AC). */
  assumptions: PlanAssumptions
  /**
   * The same per-year projection rows the Plan tab's chart uses, supplying only the `age` for
   * each year so the stress-test line chart (`PercentileLineChart`) can label its x-axis the
   * same way (FIN-47). Percentile arrays from a completed run are index-aligned 1:1 with these
   * rows (ERD §6.3), same assumption `App.tsx` previously relied on to build the (now removed)
   * Plan-tab band overlay.
   */
  rows: ChartRow[]
  /** The stock/bond mix to stress-test against (FIN-56). Defaults to {@link DEFAULT_ALLOCATION}
   * (70/30) when omitted. */
  allocation?: PortfolioAllocation
  /** Per-asset-class expected return to stress-test against (FIN-57). Defaults to
   * {@link DEFAULT_RETURN_ASSUMPTIONS} (stocks 7% / bonds 4.5%) when omitted. */
  returnAssumptions?: ReturnAssumptions
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
  /**
   * FIN-44 integration seam: called whenever the computed Monte Carlo percentile fan changes
   * (including back to `null`, e.g. on a fresh orchestrator), mirroring `onSuccessRateChange`
   * exactly — same two-effect pattern, same null-only-at-init behavior. Originally let a parent
   * (`App.tsx`) map this into `ChartContainer`'s `band` prop; FIN-47 removed that overlay and
   * this component now renders its own `PercentileLineChart` directly, so nothing in `App.tsx`
   * consumes this anymore — kept as an optional, additive seam in case another consumer needs
   * the raw percentiles later.
   */
  onPercentilesChange?: (percentiles: PercentilePaths | null) => void
  /**
   * FIN-48 integration seam: called whenever "inputs have changed since the last completed
   * run" flips, mirroring `onSuccessRateChange`/`onPercentilesChange`'s pattern. `true` from
   * the moment `assumptions` changes after a completed run, back to `false` once a run
   * completes. A parent (`App.tsx`) uses this to swap the "chance of success" `StatTile`
   * for a "Re-run stress test" CTA. Optional and additive.
   */
  onStaleChange?: (isStale: boolean) => void
}

/** Imperative handle (FIN-48): lets a parent (`App.tsx`) trigger a re-run — e.g. from the
 * Plan tab's stale "chance of success" `StatTile` — without needing to switch to the Stress
 * Test tab. `StressTestSection` stays mounted across tabs (only its parent `<section>` is
 * hidden), so the orchestrator instance this calls into is the same one already in flight. */
export interface StressTestSectionHandle {
  runStressTest: () => void
}

export const StressTestSection = forwardRef<StressTestSectionHandle, StressTestSectionProps>(function StressTestSection(
  {
    assumptions,
    rows,
    allocation = DEFAULT_ALLOCATION,
    returnAssumptions = DEFAULT_RETURN_ASSUMPTIONS,
    orchestrator: injectedOrchestrator,
    onSuccessRateChange,
    onPercentilesChange,
    onStaleChange,
  },
  ref,
) {
  const orchestrator = useMemo(() => injectedOrchestrator ?? createMonteCarloOrchestrator(), [injectedOrchestrator])
  const [state, setState] = useState<StressTestState>(() => orchestrator.getState())
  const [successRate, setSuccessRate] = useState<number | null>(null)
  const [percentiles, setPercentiles] = useState<PercentilePaths | null>(null)
  // FIN-48: "inputs changed since last completed run". Set true alongside the existing
  // cancel-on-input-change effect below, set false whenever a run completes.
  const [isStale, setIsStale] = useState(false)
  // Selected year's row, for the detail readout below the chart (FIN-61) — without this there
  // was nothing tying the slider/tap selection to any visible data, making it unclear what the
  // slider was even for.
  const [selectedRow, setSelectedRow] = useState<LineChartRow | null>(null)
  // Tracks the last `assumptions` the cancel effect has seen, so it can tell "assumptions
  // actually changed" from "this effect ran again" (e.g. StrictMode's dev-only double-invoke
  // of effects on mount). A boolean "is this the first run" ref breaks under double-invoke: it
  // gets flipped permanently on the first pass, so the second pass no longer recognizes itself
  // as the initial mount and cancels the run that the auto-run effect just started.
  const previousAssumptions = useRef(assumptions)

  useEffect(() => {
    const unsubscribe = orchestrator.subscribe(setState)
    return unsubscribe
  }, [orchestrator])

  useEffect(() => {
    if (state.status === 'complete') {
      setSuccessRate(state.result.successRate)
      setPercentiles(state.result.percentiles)
      setIsStale(false)
    }
  }, [state])

  useEffect(() => {
    onSuccessRateChange?.(successRate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [successRate])

  useEffect(() => {
    onPercentilesChange?.(percentiles)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [percentiles])

  useEffect(() => {
    onStaleChange?.(isStale)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStale])

  // Cancel-on-input-change (FIN-14 AC): keyed on `assumptions` changing, but must not fire on
  // the initial mount — there is nothing in flight to cancel yet. Also the trigger for FIN-48's
  // staleness signal: the same "assumptions actually changed" check that invalidates an
  // in-flight run also invalidates the last completed result.
  useEffect(() => {
    if (previousAssumptions.current === assumptions) {
      return
    }
    previousAssumptions.current = assumptions
    orchestrator.cancel()
    setIsStale(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assumptions])

  const handleRunClick = () => {
    orchestrator.run(assumptions, allocation, DEFAULT_VOLATILITY_ASSUMPTIONS, [], returnAssumptions).catch(() => {
      // Intentionally ignored: the orchestrator's `subscribe` callback already syncs `state`
      // to `cancelled`/`error` for both rejection paths (cancellation and worker failure).
      // This catch exists solely to prevent an unhandled promise rejection.
    })
  }

  useImperativeHandle(ref, () => ({ runStressTest: handleRunClick }))

  // Kick off one stress test against the default assumptions on load, since the projection
  // tab already shows other default-seeded values (chart, stat tiles) — an unrun "[Run
  // stress test to see results]" success rate stood out next to those. Guarded on `status
  // === 'idle'` (checked directly on the orchestrator, not React state) so this fires at
  // most once per orchestrator instance, including under StrictMode's double-invoke.
  useEffect(() => {
    if (orchestrator.getState().status === 'idle') {
      handleRunClick()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orchestrator])

  const isRunning = state.status === 'running'
  const buttonLabel = isRunning ? 'Running stress test...' : 'Run stress test'

  // Index-aligned mapping (ERD §6.3): percentiles.p10[i]/p50[i]/p90[i] correspond 1:1 with
  // rows[i], both keyed 0..horizon by construction — same assumption `App.tsx` previously used
  // to build the (now removed) Plan-tab band overlay.
  const chartRows: LineChartRow[] | null = percentiles
    ? rows.map((row, i) => ({
        age: row.age,
        year: row.year,
        values: { p10: percentiles.p10[i], p50: percentiles.p50[i], p90: percentiles.p90[i] },
      }))
    : null

  // Defaults the detail readout (and the chart's own active marker/slider position) to the
  // retirement year, mirroring the Plan tab's `retirementRow` default in App.tsx — falls back
  // to the last row if retirement age isn't present.
  const defaultRow = chartRows
    ? (chartRows.find((row) => row.age === assumptions.retirementAge) ?? chartRows.at(-1))
    : undefined

  useEffect(() => {
    if (chartRows) {
      setSelectedRow(defaultRow ?? null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [percentiles])

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

      {chartRows && (
        <div className={styles.chartRow}>
          <PercentileLineChart
            rows={chartRows}
            series={PERCENTILE_SERIES}
            title="Simulated outcomes by year"
            retirementAge={assumptions.retirementAge}
            // Mirrors App.tsx's Plan-tab default so both tabs' sliders/markers start at the same
            // year rather than this one defaulting to index 0 (current age) — FIN-61.
            defaultSelectedYear={defaultRow?.year}
            onSelectRow={setSelectedRow}
          />

          {selectedRow && (
            <Card className={styles.selectedRowCard}>
              <dl className={styles.selectedRow} aria-label="Selected year detail">
                <div className={styles.selectedRowHeadline}>
                  Age {selectedRow.age} · Year {selectedRow.year + 1}
                </div>
                <div className={styles.selectedRowValues}>
                  {PERCENTILE_SERIES.map((s) => (
                    <div key={s.key} className={styles.selectedRowValue}>
                      <dt>
                        <span className={styles.swatch} style={{ borderTopColor: s.color }} /> {s.label}
                      </dt>
                      <dd>{formatCurrency(selectedRow.values[s.key] ?? 0)}</dd>
                    </div>
                  ))}
                </div>
              </dl>
            </Card>
          )}
        </div>
      )}
    </section>
  )
})
