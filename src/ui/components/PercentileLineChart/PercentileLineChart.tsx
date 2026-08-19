import { useRef, useState, type MouseEvent } from 'react'
import { Card } from '../Card/Card'
import type { ChartBandRow } from '../ChartContainer/types'
import { formatCurrency } from '../../utils/format'
import styles from './PercentileLineChart.module.css'

/** One year's Monte Carlo percentiles plus the age that year corresponds to, so this component
 * can label its x-axis the same way `ChartContainer` does — without depending on `ChartRow`
 * itself, since only `age` is actually needed here. */
export type PercentileChartRow = ChartBandRow & { age: number }

export interface PercentileLineChartProps {
  /** One row per projected year. Presentational only — no `src/engine` calls happen here. */
  rows: PercentileChartRow[]
  /** Title shown above the chart and used as the figure's accessible name. */
  title: string
}

/** Fixed viewBox coordinate space the polylines are plotted in; scales to the rendered SVG size
 * via `viewBox`/`preserveAspectRatio` so no pixel math is needed elsewhere in this component. */
const VIEW_WIDTH = 400
const VIEW_HEIGHT = 200

const xForIndex = (index: number, lastIndex: number): number => (index / lastIndex) * VIEW_WIDTH

const toPoints = (rows: PercentileChartRow[], key: 'p10' | 'p50' | 'p90', maxValue: number): string => {
  const lastIndex = Math.max(rows.length - 1, 1)
  return rows
    .map((row, index) => {
      const x = xForIndex(index, lastIndex)
      const y = VIEW_HEIGHT - (row[key] / maxValue) * VIEW_HEIGHT
      return `${x},${y}`
    })
    .join(' ')
}

const hoverLabel = (row: PercentileChartRow): string =>
  `Age ${row.age}: 10th percentile ${formatCurrency(row.p10)}, median ${formatCurrency(row.p50)}, ` +
  `90th percentile ${formatCurrency(row.p90)}`

/**
 * A `Card`-based line chart plotting the Monte Carlo 10th/50th/90th percentile balance paths
 * over time — one line each, distinct from `ChartContainer`'s deterministic-plan bar chart
 * (FIN-47: the two were previously overlaid on one chart, which read as a confusing extra "bar
 * segment" with no legend; they're now split into separate views entirely). Includes a legend
 * so p10/p50/p90 are distinguishable at a glance, unlike the overlay it replaces.
 *
 * Hovering (or focusing, via keyboard) a point along the x-axis shows a tooltip with that year's
 * age plus its p10/p50/p90 values — the chart's only interaction, since (unlike ChartContainer's
 * bars) there's no year-detail panel this feeds into (FIN-47).
 */
export function PercentileLineChart({ rows, title }: PercentileLineChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  // Cursor position (px, relative to `plotWrapperRef`) while a point is hovered via mouse — kept
  // separate from `hoveredIndex` because a keyboard `focus` has no cursor position to track, and
  // falls back to a fixed point-aligned placement instead (see `tooltipStyle` below).
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null)
  const plotWrapperRef = useRef<HTMLDivElement>(null)
  const firstAge = rows.at(0)?.age
  const lastAge = rows.at(-1)?.age
  const maxValue = Math.max(1, ...rows.map((row) => row.p90))
  const lastIndex = Math.max(rows.length - 1, 1)
  const hoveredRow = hoveredIndex !== null ? rows[hoveredIndex] : undefined

  // Tracks the mouse across the hover targets so the tooltip can follow the cursor rather than
  // sit at a fixed vertical position (FIN-47 round 2 feedback: a fixed position read as
  // disconnected from what was being hovered).
  const handlePointerMove = (index: number, event: MouseEvent) => {
    setHoveredIndex(index)
    const wrapperRect = plotWrapperRef.current?.getBoundingClientRect()
    if (wrapperRect) {
      setCursorPos({ x: event.clientX - wrapperRect.left, y: event.clientY - wrapperRect.top })
    }
  }

  const handlePointerLeave = () => {
    setHoveredIndex(null)
    setCursorPos(null)
  }

  // Keyboard focus has no cursor position, so fall back to the hovered point's own x (as a
  // percentage of the plot width) anchored near the top of the plot.
  const tooltipStyle =
    hoveredIndex !== null && cursorPos
      ? { left: cursorPos.x, top: cursorPos.y }
      : { left: `${(xForIndex(hoveredIndex ?? 0, lastIndex) / VIEW_WIDTH) * 100}%`, top: 0 }

  return (
    <Card className={styles.card}>
      <figure className={styles.figure} aria-label={title}>
        <div className={styles.titleRow}>
          <figcaption className={styles.title}>{title}</figcaption>
          {firstAge !== undefined && lastAge !== undefined && (
            <div className={styles.subtitle}>
              Age {firstAge} → {lastAge}
            </div>
          )}
        </div>

        {rows.length > 0 && (
          <>
            <div className={styles.plotWrapper} ref={plotWrapperRef}>
              <svg
                className={styles.plot}
                viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <polyline className={styles.p10Line} points={toPoints(rows, 'p10', maxValue)} />
                <polyline className={styles.p90Line} points={toPoints(rows, 'p90', maxValue)} />
                <polyline className={styles.p50Line} points={toPoints(rows, 'p50', maxValue)} />
              </svg>

              <div className={styles.hoverTargets}>
                {rows.map((row, index) => (
                  <button
                    key={row.year}
                    type="button"
                    className={styles.hoverTarget}
                    aria-label={hoverLabel(row)}
                    onMouseMove={(event) => handlePointerMove(index, event)}
                    onMouseEnter={(event) => handlePointerMove(index, event)}
                    onMouseLeave={handlePointerLeave}
                    onFocus={() => setHoveredIndex(index)}
                    onBlur={handlePointerLeave}
                  />
                ))}
              </div>

              {hoveredRow && (
                <output className={styles.tooltip} style={tooltipStyle}>
                  <div className={styles.tooltipAge}>Age {hoveredRow.age}</div>
                  <div className={styles.tooltipRow}>
                    <span className={`${styles.swatch} ${styles.p90Swatch}`} /> {formatCurrency(hoveredRow.p90)}
                  </div>
                  <div className={styles.tooltipRow}>
                    <span className={`${styles.swatch} ${styles.p50Swatch}`} /> {formatCurrency(hoveredRow.p50)}
                  </div>
                  <div className={styles.tooltipRow}>
                    <span className={`${styles.swatch} ${styles.p10Swatch}`} /> {formatCurrency(hoveredRow.p10)}
                  </div>
                </output>
              )}
            </div>
            <ul className={styles.legend}>
              <li className={styles.legendItem}>
                <span className={`${styles.swatch} ${styles.p90Swatch}`} /> 90th percentile
              </li>
              <li className={styles.legendItem}>
                <span className={`${styles.swatch} ${styles.p50Swatch}`} /> Median (50th percentile)
              </li>
              <li className={styles.legendItem}>
                <span className={`${styles.swatch} ${styles.p10Swatch}`} /> 10th percentile
              </li>
            </ul>
          </>
        )}
      </figure>
    </Card>
  )
}
