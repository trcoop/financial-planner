import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Card } from '../Card/Card'
import styles from './ChartContainer.module.css'
import type { ChartRow } from './types'

/** Show an age label every this-many bars (plus always the last), so a long horizon doesn't
 * cram one label per hairline-thin bar. */
const LABEL_INTERVAL = 5

export interface ChartContainerProps {
  /** One row per projected year. Presentational only — no `src/engine` calls happen here. */
  rows: ChartRow[]
  /** Title shown above the chart and used as the figure's accessible name. */
  title: string
  /**
   * Called with the newly selected row whenever a bar is clicked/tapped. ChartContainer owns
   * selection state internally (uncontrolled) and lifts the selected row up via this
   * callback — it does not accept a controlled `selectedYear` prop. Parents that need to
   * react to selection (e.g. to drive `YearDetailPanel`) should hold their own state updated
   * from this callback, seeded from `defaultSelectedYear` (or `rows.at(-1)` if omitted) to
   * mirror ChartContainer's own default.
   */
  onSelectRow?: (row: ChartRow) => void
  /**
   * The `year` to select initially, e.g. the retirement year rather than the last year of the
   * horizon. Only affects the initial render (uncontrolled, like the rest of ChartContainer's
   * selection state) — falls back to `rows.at(-1)?.year` when omitted or when no row matches.
   */
  defaultSelectedYear?: number
  /** Age at which the retirement-year marker renders (PRD Goal #3). Renders nothing if the
   * age isn't present in `rows`. */
  retirementAge?: number
}

/** One bar's measured position relative to `.plot`, read via `getBoundingClientRect` in a
 * layout effect (see ERD §6.4) rather than recreated from the flex/gap CSS in JS, so it can
 * never drift from the real rendered layout. */
interface BarLayout {
  left: number
  width: number
}

/**
 * A `Card`-based bar chart: one bar per year, height proportional to `endingBalance`.
 * Clicking/tapping a bar selects that year (default: `defaultSelectedYear`, or the last year
 * in `rows` if omitted) and reports the selection via `onSelectRow`.
 *
 * Shows the deterministic plan only — no Monte Carlo overlay. FIN-42 originally overlaid a
 * shaded p10-p90 band behind the bars; FIN-47 removed that entirely (it read as a confusing
 * second "bar segment" with no legend) in favor of a dedicated percentile line chart on the
 * Stress Test tab (`PercentileLineChart`). The retirement-year marker (also FIN-42) is
 * unrelated to the band and stays.
 */
export function ChartContainer({ rows, title, onSelectRow, defaultSelectedYear, retirementAge }: ChartContainerProps) {
  const [selectedYear, setSelectedYear] = useState<number | undefined>(() => {
    const hasMatch = defaultSelectedYear !== undefined && rows.some((row) => row.year === defaultSelectedYear)
    return hasMatch ? defaultSelectedYear : rows.at(-1)?.year
  })
  const trackRef = useRef<HTMLDivElement>(null)
  const selectedBarRef = useRef<HTMLButtonElement>(null)
  const plotRef = useRef<HTMLDivElement>(null)
  const barRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [barLayout, setBarLayout] = useState<BarLayout[]>([])

  const maxBalance = Math.max(1, ...rows.map((row) => row.endingBalance))

  const handleSelect = (row: ChartRow) => {
    setSelectedYear(row.year)
    onSelectRow?.(row)
  }

  const firstAge = rows.at(0)?.age
  const lastAge = rows.at(-1)?.age
  const lastIndex = rows.length - 1

  // Land the scroll track on the initially-selected bar (the last row) instead of the far
  // left edge, since that's the bar most users care about on a long horizon. Only runs once
  // on mount — later selections scroll via the browser's native focus/click behavior.
  useEffect(() => {
    selectedBarRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Retirement-marker overlay positioning (FIN-42, ERD §6.4). Rather than recreating the
  // `.plot` flex/gap layout arithmetically in JS (which would silently drift if that CSS ever
  // changes), this measures the real rendered bar rects via `getBoundingClientRect` and stores
  // each bar's position relative to `.plot`, for an absolutely-positioned overlay div to
  // consume. Runs even when retirementAge is absent — cheap at MVP's row counts (≤65 bars) and
  // keeps the measuring logic in one place rather than conditionally skipping it.
  useLayoutEffect(() => {
    const plotEl = plotRef.current
    if (!plotEl) return

    const measure = () => {
      const plotRect = plotEl.getBoundingClientRect()
      const layout = barRefs.current.map((bar): BarLayout => {
        if (!bar) return { left: 0, width: 0 }
        const barRect = bar.getBoundingClientRect()
        return { left: barRect.left - plotRect.left, width: barRect.width }
      })
      setBarLayout(layout)
    }

    measure()

    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measure())
    observer.observe(plotEl)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows])

  const retirementIndex = retirementAge === undefined ? -1 : rows.findIndex((row) => row.age === retirementAge)

  return (
    <Card className={styles.card}>
      <figure
        className={styles.figure}
        aria-label={title}
        // Inline (in addition to the CSS module rules) so the "never wider than its
        // container" contract is enforced regardless of stylesheet load order, and so it's
        // directly assertable in jsdom, which doesn't apply CSS module rules.
        style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}
      >
        <div className={styles.titleRow}>
          <figcaption className={styles.title}>{title}</figcaption>
          {firstAge !== undefined && lastAge !== undefined && (
            <div className={styles.subtitle}>
              Age {firstAge} → {lastAge}
            </div>
          )}
        </div>
        <div className={styles.track} ref={trackRef}>
          <div className={styles.plot} ref={plotRef}>
            {retirementIndex >= 0 && barLayout[retirementIndex] && (
              <div
                data-testid="chart-retirement-marker"
                className={styles.retirementMarker}
                style={{
                  left: `${barLayout[retirementIndex].left}px`,
                  width: `${barLayout[retirementIndex].width}px`,
                  pointerEvents: 'none',
                }}
              />
            )}
            {rows.map((row, index) => {
              const heightPercent = (row.endingBalance / maxBalance) * 100
              const isSelected = row.year === selectedYear
              return (
                <button
                  key={row.year}
                  ref={(el) => {
                    barRefs.current[index] = el
                    if (isSelected) selectedBarRef.current = el
                  }}
                  type="button"
                  className={isSelected ? styles.barSelected : styles.bar}
                  style={{ height: `${heightPercent}%` }}
                  aria-pressed={isSelected}
                  aria-label={`Year ${row.year + 1}, age ${row.age}`}
                  onClick={() => handleSelect(row)}
                />
              )
            })}
          </div>
          <div className={styles.labels} aria-hidden="true">
            {rows.map((row, index) => (
              <div key={row.year} className={styles.label}>
                {index % LABEL_INTERVAL === 0 || index === lastIndex ? row.age : ''}
              </div>
            ))}
          </div>
        </div>
      </figure>
    </Card>
  )
}
