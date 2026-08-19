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
  /** Age at which the permanent retirement-year marker renders (FIN-47 round 5) — same idea as
   * ChartContainer's retirement marker on the Plan tab (PRD Goal #3), reusing its dashed-line
   * styling for visual consistency between the two tabs. Renders nothing if the age isn't
   * present in `rows`. */
  retirementAge?: number
}

/** Fixed viewBox coordinate space the polylines are plotted in; scales to the rendered SVG size
 * via `viewBox`/`preserveAspectRatio` so no pixel math is needed elsewhere in this component. */
const VIEW_WIDTH = 400
const VIEW_HEIGHT = 200

/** Y-axis gridlines are drawn at these fractions of `maxValue`, top to bottom — gives a sense of
 * scale (FIN-47 round 5) without cluttering a chart that already has three lines, a hover line,
 * and a retirement marker on it. */
const GRIDLINE_FRACTIONS = [1, 0.75, 0.5, 0.25, 0]

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
export function PercentileLineChart({ rows, title, retirementAge }: PercentileLineChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  // Cursor position (px, relative to `plotWrapperRef`) while a point is hovered via mouse, plus
  // which edges it's close enough to that the tooltip should flip instead of running off-screen
  // (FIN-47 round 3: near the plot's right edge, the default up-and-right offset pushed the
  // tooltip past the viewport). Kept separate from `hoveredIndex` because a keyboard `focus` has
  // no cursor position to track, and falls back to a fixed point-aligned placement instead (see
  // `tooltipStyle` below).
  const [cursorPos, setCursorPos] = useState<{
    x: number
    y: number
    flipX: boolean
    flipY: boolean
  } | null>(null)
  const plotWrapperRef = useRef<HTMLDivElement>(null)
  const firstAge = rows.at(0)?.age
  const lastAge = rows.at(-1)?.age
  const maxValue = Math.max(1, ...rows.map((row) => row.p90))
  const lastIndex = Math.max(rows.length - 1, 1)
  const hoveredRow = hoveredIndex !== null ? rows[hoveredIndex] : undefined

  // Tracks the mouse across the hover targets so the tooltip can follow the cursor rather than
  // sit at a fixed vertical position (FIN-47 round 2 feedback: a fixed position read as
  // disconnected from what was being hovered). `flipX`/`flipY` use the wrapper's own measured
  // size (rather than a fixed pixel threshold) so this still works across the mobile fixed-aspect
  // fallback and the desktop fill-height layout alike.
  const handlePointerMove = (index: number, event: MouseEvent) => {
    setHoveredIndex(index)
    const wrapperRect = plotWrapperRef.current?.getBoundingClientRect()
    if (wrapperRect) {
      const x = event.clientX - wrapperRect.left
      const y = event.clientY - wrapperRect.top
      setCursorPos({
        x,
        y,
        flipX: x > wrapperRect.width * 0.75,
        flipY: y < wrapperRect.height * 0.25,
      })
    }
  }

  const handlePointerLeave = () => {
    setHoveredIndex(null)
    setCursorPos(null)
  }

  // Keyboard focus has no cursor position, so fall back to the hovered point's own x (as a
  // percentage of the plot width) anchored near the top of the plot, using the default
  // top-right-offset transform from PercentileLineChart.module.css (no inline `transform` here).
  const tooltipStyle =
    hoveredIndex !== null && cursorPos
      ? {
          left: cursorPos.x,
          top: cursorPos.y,
          transform: `translate(${cursorPos.flipX ? 'calc(-100% - 12px)' : '12px'}, ${
            cursorPos.flipY ? '12px' : '-100%'
          })`,
        }
      : { left: `${(xForIndex(hoveredIndex ?? 0, lastIndex) / VIEW_WIDTH) * 100}%`, top: 0 }

  const hoverLineX = hoveredIndex !== null ? xForIndex(hoveredIndex, lastIndex) : null

  const retirementIndex = retirementAge === undefined ? -1 : rows.findIndex((row) => row.age === retirementAge)
  const retirementX = retirementIndex >= 0 ? xForIndex(retirementIndex, lastIndex) : null

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
                {/* Gives a sense of scale (FIN-47 round 5) — otherwise the only way to read an
                    absolute value off this chart is the hover tooltip. */}
                {GRIDLINE_FRACTIONS.map((fraction) => (
                  <line
                    key={fraction}
                    className={styles.gridLine}
                    x1={0}
                    x2={VIEW_WIDTH}
                    y1={VIEW_HEIGHT * (1 - fraction)}
                    y2={VIEW_HEIGHT * (1 - fraction)}
                  />
                ))}
                <polyline className={styles.p10Line} points={toPoints(rows, 'p10', maxValue)} />
                <polyline className={styles.p90Line} points={toPoints(rows, 'p90', maxValue)} />
                <polyline className={styles.p50Line} points={toPoints(rows, 'p50', maxValue)} />
                {/* Marks which point along the x-axis the tooltip's values belong to (FIN-47
                    round 3) — otherwise, with the tooltip now free-floating at the cursor rather
                    than pinned above a specific bar, there's nothing tying it back to an exact
                    age on the plot. */}
                {hoverLineX !== null && (
                  <line
                    className={styles.hoverLine}
                    x1={hoverLineX}
                    x2={hoverLineX}
                    y1={0}
                    y2={VIEW_HEIGHT}
                  />
                )}
              </svg>

              {/* Permanent retirement-year marker (FIN-47 round 5) — same dashed-line pattern as
                  ChartContainer's `.retirementMarker` on the Plan tab, reused here (rather than
                  drawn as another SVG <line>) so the two tabs read as visually consistent. Unlike
                  the hover line above, this doesn't depend on hover state and stays visible. */}
              {retirementX !== null && (
                <div
                  data-testid="percentile-chart-retirement-marker"
                  className={styles.retirementMarker}
                  style={{ left: `${(retirementX / VIEW_WIDTH) * 100}%` }}
                />
              )}

              {/* Dollar-amount labels for the gridlines above — an HTML overlay rather than SVG
                  <text>, since the SVG's non-uniform scale (`preserveAspectRatio="none"`) would
                  distort text the same way it would a circle. */}
              <div className={styles.yAxisLabels} aria-hidden="true">
                {GRIDLINE_FRACTIONS.map((fraction) => (
                  <div
                    key={fraction}
                    data-testid="percentile-chart-y-axis-label"
                    className={styles.yAxisLabel}
                    style={{ top: `${(1 - fraction) * 100}%` }}
                  >
                    {formatCurrency(fraction * maxValue)}
                  </div>
                ))}
              </div>

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
