import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { Card } from '../Card/Card'
import { formatCurrency } from '../../utils/format'
import styles from './PercentileLineChart.module.css'

/** One projected year's worth of data points, one per series (keyed by `LineChartSeries.key`).
 * Generic over the caller's series set (FIN-60) — Plan supplies one `values` entry (its
 * deterministic balance), Stress Test supplies three (`p10`/`p50`/`p90`) — so this single
 * component can back both the Plan tab's line chart and the Stress Test tab's percentile fan. */
export interface LineChartRow {
  year: number
  /** Optional (FIN-108): Plan and Stress Test always pass this and keep rendering "Age X" in the
   * subtitle/tooltip/aria-label exactly as before. When absent (e.g. the Investment Calculator,
   * which has no notion of the user's age), those same three places fall back to "Year X"
   * phrasing instead. */
  age?: number
  values: Record<string, number>
}

/** One line's identity: which `values` key it plots, its legend label, and the color used for
 * its line, shaded area, and legend swatch (FIN-60 replaces dash/solid style differences with
 * color, since a single-line Plan chart has no "other line" to visually distinguish from).
 *
 * `series` order matters for shading: each line's area fills from that line down to the *next*
 * series in the array (or the chart bottom for the last one) — so pass series ordered from
 * highest-typical-value to lowest (e.g. Stress Test's p90, p50, p10) for the bands to read as
 * "between this line and the one below it" rather than overlapping oddly. */
export interface LineChartSeries {
  key: string
  label: string
  /** Any valid CSS color (a `var(--color-*)` token is expected) — applied to the line stroke,
   * its shaded area (at reduced opacity), and its legend swatch. */
  color: string
}

/** Back-compat alias — `StressTestSection` (FIN-47) already imports this name; kept so that
 * generalizing this component to arbitrary series (FIN-60) doesn't force an unrelated rename
 * at every call site. */
export type PercentileChartRow = LineChartRow

export interface PercentileLineChartProps {
  /** One row per projected year. Presentational only — no `src/engine` calls happen here. */
  rows: LineChartRow[]
  /** The lines to plot, in shading-adjacency order (see {@link LineChartSeries}). */
  series: LineChartSeries[]
  /** Title shown above the chart and used as the figure's accessible name. */
  title: string
  /** Age at which the permanent retirement-year marker renders. Renders nothing if the age
   * isn't present in `rows`. */
  retirementAge?: number
  /**
   * Age at which the permanent Medicare-start marker renders (FIN-73). Computed at the call
   * site, not here — the chart only sees `rows`, while the call site already knows
   * `currentAge`/`planningHorizonEndAge` from `assumptions` and can apply the suppression
   * rules (horizon ends before 65; current age already >= 65 at t=0, which would mislabel
   * period 0) before ever passing this prop. Renders nothing if the age isn't present in
   * `rows`, same as `retirementAge`. */
  medicareStartAge?: number
  /**
   * Called with the newly selected row whenever a time slice is clicked/tapped (FIN-60). This
   * component owns selection ("active period") state internally (uncontrolled) and lifts the
   * selected row up via this callback — mirroring `ChartContainer`'s `onSelectRow` contract so
   * both the Plan tab's bar chart it replaces, and now this chart, share the same shape.
   * Optional: Stress Test still tracks the active period internally (for a solid active-period
   * marker) even though it has nowhere to display the details yet.
   */
  onSelectRow?: (row: LineChartRow) => void
  /**
   * The `year` to select initially, e.g. the retirement year rather than the last year of the
   * horizon. Only affects the initial render (uncontrolled) — falls back to no active period
   * when omitted or when no row matches.
   */
  defaultSelectedYear?: number
  /** Hides the legend — Plan has a single line and the legend would just repeat the chart
   * title, so it passes `false` here. Stress Test's three-line legend is unaffected (defaults
   * to shown). */
  showLegend?: boolean
  /**
   * Hides the active-period marker (the bold vertical line for the clicked/`defaultSelectedYear`
   * period) without disabling selection itself — `onSelectRow` still fires and `selectedYear`
   * state is still tracked internally, there's just nothing drawn for it. Stress Test passes
   * `false` here because it has no UI yet to show details for the selected period (FIN-60); flip
   * it back to `true` (or drop the prop) once that display exists. Defaults to `true`.
   */
  showActiveMarker?: boolean
}

/** Fixed viewBox coordinate space the polylines are plotted in; scales to the rendered SVG size
 * via `viewBox`/`preserveAspectRatio` so no pixel math is needed elsewhere in this component. */
const VIEW_WIDTH = 400
const VIEW_HEIGHT = 200

/** Y-axis gridlines are drawn at these fractions of `maxValue`, top to bottom — gives a sense of
 * scale without cluttering a chart that can have multiple lines, a hover line, and markers. */
const GRIDLINE_FRACTIONS = [1, 0.75, 0.5, 0.25, 0]

const xForIndex = (index: number, lastIndex: number): number => (index / lastIndex) * VIEW_WIDTH
const yForValue = (value: number, maxValue: number): number => VIEW_HEIGHT - (value / maxValue) * VIEW_HEIGHT

const toPoints = (rows: LineChartRow[], key: string, maxValue: number): string => {
  const lastIndex = Math.max(rows.length - 1, 1)
  return rows
    .map((row, index) => `${xForIndex(index, lastIndex)},${yForValue(row.values[key] ?? 0, maxValue)}`)
    .join(' ')
}

/** Builds the shaded-area polygon for one series: its own line as the top edge, and either the
 * next series' line (reversed, to close the polygon) or the chart's bottom edge as the bottom
 * edge — per FIN-60, "shading beneath each line, from that line down to the next line (or the
 * chart bottom for the last line)". */
const toAreaPoints = (rows: LineChartRow[], topKey: string, bottomKey: string | undefined, maxValue: number): string => {
  const lastIndex = Math.max(rows.length - 1, 1)
  const top = rows.map((row, index) => `${xForIndex(index, lastIndex)},${yForValue(row.values[topKey] ?? 0, maxValue)}`)
  const bottom = [...rows]
    .reverse()
    .map((row, reversedIndex) => {
      const index = rows.length - 1 - reversedIndex
      const y = bottomKey === undefined ? VIEW_HEIGHT : yForValue(row.values[bottomKey] ?? 0, maxValue)
      return `${xForIndex(index, lastIndex)},${y}`
    })
  return [...top, ...bottom].join(' ')
}

/** Values at/above this show as an abbreviated "$X.XM"; below it (but still $1M+) show as a full
 * number rounded to the nearest $100k instead — right at the 7-figure boundary, "$1.2M" reads as
 * terser than it needs to be, while a number like "$5.2M" is comfortably abbreviated. */
const ABBREVIATE_THRESHOLD = 2_000_000
const NEAR_MILLION_ROUNDING = 100_000
const SUB_MILLION_ROUNDING = 10_000

/** Rounds a y-axis gridline value and formats it — never to dollar-and-cent precision, and
 * increasingly coarse as the value grows, so the axis reads as "sense of scale" rather than an
 * exact figure (which the hover tooltip already provides). */
const formatAxisValue = (value: number): string => {
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)

  if (abs >= ABBREVIATE_THRESHOLD) {
    return `${sign}$${(abs / 1_000_000).toFixed(1)}M`
  }
  if (abs >= 1_000_000) {
    return `${sign}${formatCurrency(Math.round(abs / NEAR_MILLION_ROUNDING) * NEAR_MILLION_ROUNDING)}`
  }
  return `${sign}${formatCurrency(Math.round(abs / SUB_MILLION_ROUNDING) * SUB_MILLION_ROUNDING)}`
}

/** "Age X" when `row.age` is present (Plan, Stress Test — unaffected), else the FIN-108 "Year X"
 * fallback (Investment Calculator, which has no age concept) — shared by the subtitle, the
 * tooltip, and each hover target's aria-label so all three stay in sync. */
const periodLabel = (row: LineChartRow): string => (row.age !== undefined ? `Age ${row.age}` : `Year ${row.year}`)

const hoverLabel = (row: LineChartRow, series: LineChartSeries[]): string =>
  `${periodLabel(row)}: ` + series.map((s) => `${s.label} ${formatCurrency(row.values[s.key] ?? 0)}`).join(', ')

/**
 * A `Card`-based line chart plotting one or more value series over time — shared by the Plan
 * tab (one line: the deterministic balance) and the Stress Test tab (three lines: the Monte
 * Carlo p10/p50/p90 balance paths) (FIN-60, generalizing FIN-47's Stress-Test-only chart).
 *
 * Three kinds of vertical line can appear at once, visually distinguished (FIN-60 — see the
 * CSS module for exact styling, and the PR description for the specific choice, which is a
 * judgment call open for design feedback):
 *  - a permanent **retirement-year marker** (dashed, muted) — always present if `retirementAge`
 *    matches a row;
 *  - a **hover line** (thin, muted, solid) that follows the mouse and drives the tooltip;
 *  - an **active-period line** (bold, solid, high-contrast) for whichever period was last
 *    clicked (or `defaultSelectedYear`) — for the Plan tab this is also what
 *    `YearDetailPanel` displays.
 *
 * Each series gets its own color (replacing FIN-47's dashed/solid distinction, which doesn't
 * generalize to a single-line chart) and a light shaded area beneath it, down to the next
 * series or the chart bottom.
 */
export function PercentileLineChart({
  rows,
  series,
  title,
  retirementAge,
  medicareStartAge,
  onSelectRow,
  defaultSelectedYear,
  showLegend = true,
  showActiveMarker = true,
}: PercentileLineChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [selectedYear, setSelectedYear] = useState<number | undefined>(() => {
    const hasMatch = defaultSelectedYear !== undefined && rows.some((row) => row.year === defaultSelectedYear)
    return hasMatch ? defaultSelectedYear : undefined
  })
  // Cursor position (px, relative to `plotWrapperRef`) while a point is hovered via mouse, plus
  // which edges it's close enough to that the tooltip should flip instead of running off-screen.
  // Kept separate from `hoveredIndex` because a keyboard `focus` has no cursor position to
  // track, and falls back to a fixed point-aligned placement instead (see `tooltipStyle` below).
  const [cursorPos, setCursorPos] = useState<{
    x: number
    y: number
    flipX: boolean
    flipY: boolean
  } | null>(null)
  const plotWrapperRef = useRef<HTMLDivElement>(null)
  const firstRow = rows.at(0)
  const lastRow = rows.at(-1)
  const dataMaxValue = Math.max(1, ...rows.flatMap((row) => series.map((s) => row.values[s.key] ?? 0)))
  // Scales the plotted y-axis above the data's own peak so the highest line never touches the
  // top edge of the chart — without this, the permanent Medicare-start marker (which sits fixed
  // near the top of the plot regardless of the line's value, see `.medicareMarker` below) has
  // nowhere to sit that doesn't crowd or overlap the line itself when the balance peaks near the
  // top of its range. Applied to both the plotted lines (`yForValue`) and the gridlines/axis
  // labels so they stay consistent with each other.
  const CHART_HEADROOM_FACTOR = 1.15
  const maxValue = dataMaxValue * CHART_HEADROOM_FACTOR
  const lastIndex = Math.max(rows.length - 1, 1)
  const hoveredRow = hoveredIndex !== null ? rows[hoveredIndex] : undefined

  // Tracks the mouse across the hover targets so the tooltip can follow the cursor rather than
  // sit at a fixed vertical position. `flipX`/`flipY` use the wrapper's own measured size
  // (rather than a fixed pixel threshold) so this still works across the mobile fixed-aspect
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

  const handleSelect = (index: number) => {
    const row = rows[index]
    if (!row) return
    setSelectedYear(row.year)
    onSelectRow?.(row)
  }

  // Touch has no hover concept and, once a finger is down on one of `.hoverTarget`'s narrow
  // per-point buttons, the browser keeps routing touchmove to that same original target rather
  // than whichever point the finger is now visually over — so touch can't reuse
  // `handlePointerMove`'s per-button approach the way mouse does. Instead this computes the
  // nearest point directly from the touch's x position across the whole plot width.
  //
  // Attached as native (not React synthetic) listeners because `touchmove`'s `preventDefault` —
  // needed so a drag moves the tooltip instead of scrolling the page — throws
  // "Unable to preventDefault inside passive event listener invocation" under React's default
  // passive touch listeners; a manually-attached `{ passive: false }` listener is the only way
  // to opt back in.
  //
  // Only a drag (touchmove) shows the tooltip, mirroring "press and hold, then drag to
  // preview" — the mouse-hover equivalent. A plain tap (touchstart -> touchend with no move in
  // between) instead just selects the nearest point directly, the same as a click, without ever
  // flashing a tooltip that has no gesture to dismiss it.
  useEffect(() => {
    const wrapper = plotWrapperRef.current
    if (!wrapper) return

    let dragged = false
    let draggedIndex: number | null = null

    const nearestIndexFromClientX = (clientX: number): number => {
      const wrapperRect = wrapper.getBoundingClientRect()
      if (wrapperRect.width === 0) return 0
      const ratio = (clientX - wrapperRect.left) / wrapperRect.width
      return Math.min(lastIndex, Math.max(0, Math.round(ratio * lastIndex)))
    }

    const updateTouchHover = (touch: { clientX: number; clientY: number }) => {
      const index = nearestIndexFromClientX(touch.clientX)
      draggedIndex = index
      setHoveredIndex(index)
      const wrapperRect = wrapper.getBoundingClientRect()
      const x = touch.clientX - wrapperRect.left
      const y = touch.clientY - wrapperRect.top
      setCursorPos({
        x,
        y,
        flipX: x > wrapperRect.width * 0.75,
        flipY: y < wrapperRect.height * 0.25,
      })
    }

    const onTouchStart = () => {
      dragged = false
    }

    const onTouchMove = (event: globalThis.TouchEvent) => {
      event.preventDefault()
      dragged = true
      updateTouchHover(event.touches[0])
    }

    const onTouchEnd = (event: globalThis.TouchEvent) => {
      // Without this, an untouched touchend lets the browser follow up with its usual
      // touch-compatibility mouse events (mouseenter/mousemove/click) on whichever hover-target
      // button sits under the finger — `handlePointerMove` then re-sets `hoveredIndex` and the
      // tooltip pops back up and sticks, since no further mouse event ever clears it on a
      // touch-only device. Suppressing those synthetic events is the whole point of calling this.
      event.preventDefault()
      const index = dragged ? draggedIndex : nearestIndexFromClientX(event.changedTouches[0].clientX)
      if (index !== null) handleSelect(index)
      setHoveredIndex(null)
      setCursorPos(null)
    }

    wrapper.addEventListener('touchstart', onTouchStart)
    wrapper.addEventListener('touchmove', onTouchMove, { passive: false })
    wrapper.addEventListener('touchend', onTouchEnd)
    wrapper.addEventListener('touchcancel', onTouchEnd)
    return () => {
      wrapper.removeEventListener('touchstart', onTouchStart)
      wrapper.removeEventListener('touchmove', onTouchMove)
      wrapper.removeEventListener('touchend', onTouchEnd)
      wrapper.removeEventListener('touchcancel', onTouchEnd)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastIndex, rows])

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

  const medicareIndex = medicareStartAge === undefined ? -1 : rows.findIndex((row) => row.age === medicareStartAge)
  const medicareX = medicareIndex >= 0 ? xForIndex(medicareIndex, lastIndex) : null
  // Y-position clears the highest plotted line's value across a small window of nearby rows,
  // not just the marker's own exact row — anchoring to a single row let a line climbing steeply
  // just a few years to either side (e.g. balance still rising toward retirement shortly after
  // 65) pass close beside/above the marker even though the marker's own row was clear when it
  // was placed. `MEDICARE_MARKER_CLEARANCE_WINDOW_YEARS` rows on each side is enough to cover
  // that "a few years over" case without pulling in the whole chart's peak (which is what the
  // per-row fixed-from-top approach effectively did, and looked wrong on Stress Test's p90 — see
  // the note below). Not tracking engine internals — `rows`/`series` are already the chart's own
  // presentational data.
  const MEDICARE_MARKER_CLEARANCE_WINDOW_YEARS = 5
  const medicareWindowStart = medicareIndex >= 0 ? Math.max(0, medicareIndex - MEDICARE_MARKER_CLEARANCE_WINDOW_YEARS) : -1
  const medicareWindowEnd =
    medicareIndex >= 0 ? Math.min(rows.length - 1, medicareIndex + MEDICARE_MARKER_CLEARANCE_WINDOW_YEARS) : -1
  const medicareTopValue =
    medicareIndex >= 0
      ? Math.max(
          0,
          ...rows
            .slice(medicareWindowStart, medicareWindowEnd + 1)
            .flatMap((row) => series.map((s) => row.values[s.key] ?? 0)),
        )
      : 0
  // Y-position tracks that windowed value (not a fixed offset from the chart's top edge) — a
  // fixed-from-top offset put the marker right at the container edge on charts whose lines climb
  // steeply toward the right (e.g. Stress Test's p90), since the chart's own top edge is set by
  // the *overall* series max, which can sit well above this particular row's value. Tracking the
  // windowed value keeps a consistent visual clearance above the line in both the Plan tab's
  // single-line chart and Stress Test's three-line fan.
  const medicareY = medicareIndex >= 0 ? yForValue(medicareTopValue, maxValue) : null
  const medicareYPercent = medicareY !== null ? (medicareY / VIEW_HEIGHT) * 100 : null

  const selectedIndex = selectedYear === undefined ? -1 : rows.findIndex((row) => row.year === selectedYear)
  const selectedX = selectedIndex >= 0 ? xForIndex(selectedIndex, lastIndex) : null

  return (
    <Card className={styles.card}>
      <figure className={styles.figure} aria-label={title}>
        <div className={styles.titleRow}>
          <figcaption className={styles.title}>{title}</figcaption>
          {firstRow && lastRow && (
            <div className={styles.subtitle}>
              {firstRow.age !== undefined ? `Age ${firstRow.age}` : `Year ${firstRow.year}`} →{' '}
              {lastRow.age !== undefined ? lastRow.age : `Year ${lastRow.year}`}
            </div>
          )}
        </div>

        {rows.length > 0 && (
          <>
            {/* A second, discoverable way to move through years besides clicking/tapping a point
                directly on the plot — driven by the same `selectedYear`/`handleSelect` state a
                click already sets, so it works identically on desktop and mobile rather than
                being mobile-only UI (FIN-61). */}
            <input
              type="range"
              className={styles.yearSlider}
              aria-label={`Select a year on ${title}`}
              min={0}
              max={lastIndex}
              step={1}
              value={selectedIndex >= 0 ? selectedIndex : 0}
              onChange={(event) => handleSelect(Number(event.target.value))}
            />
            <div className={styles.plotWrapper} ref={plotWrapperRef}>
              <svg
                className={styles.plot}
                viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {/* Gives a sense of scale — otherwise the only way to read an absolute value
                    off this chart is the hover tooltip. */}
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

                {/* Shaded area beneath each line, down to the next line (or the chart bottom
                    for the last one), at the line's own color and low opacity (FIN-60). */}
                {series.map((s, index) => (
                  <polygon
                    key={`area-${s.key}`}
                    className={styles.area}
                    style={{ fill: s.color }}
                    points={toAreaPoints(rows, s.key, series[index + 1]?.key, maxValue)}
                  />
                ))}

                {series.map((s) => (
                  <polyline
                    key={`line-${s.key}`}
                    className={styles.line}
                    style={{ stroke: s.color }}
                    points={toPoints(rows, s.key, maxValue)}
                  />
                ))}

                {/* Marks which point along the x-axis the tooltip's values belong to — otherwise,
                    with the tooltip free-floating at the cursor rather than pinned above a
                    specific bar, there's nothing tying it back to an exact age on the plot. */}
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

              {/* Permanent retirement-year marker (dashed) — stays visible regardless of hover
                  or selection state. */}
              {retirementX !== null && (
                <div
                  data-testid="percentile-chart-retirement-marker"
                  className={styles.retirementMarker}
                  style={{ left: `${(retirementX / VIEW_WIDTH) * 100}%` }}
                />
              )}

              {/* Permanent Medicare-start marker (FIN-73) — a one-time icon at age 65, distinct
                  from the dashed retirement marker so the two don't read as the same kind of
                  event when they land near each other. Icon is an explicit placeholder (PRD
                  Open Questions / ERD §11 Q4) — swapping it later is not a data-contract
                  change. `title` gives the exact-text tooltip as an accessible-name fallback;
                  `.medicareLabel` is the actual visible-on-hover/focus text (round 2 — a native
                  `title` tooltip's only visible affordance turned out to be the generic "?" help
                  cursor, not readable text), so both a mouse hover and a keyboard focus show
                  "Medicare starts." on screen, not just to assistive tech. A real `<button>`
                  (not a `div` with `tabIndex`) so it's natively focusable/interactive rather than
                  faking that with an ARIA/tabIndex workaround. `top` is set inline per-render
                  (round 3) to the *row's own* highest plotted value at this age rather than a
                  fixed distance from the chart's top edge — a fixed-from-top offset landed the
                  marker right at the container edge on charts whose lines climb steeply toward
                  the right (Stress Test's p90), since the chart's top edge is set by the overall
                  series max, not this particular row's value. */}
              {medicareX !== null && medicareYPercent !== null && (
                <button
                  type="button"
                  data-testid="percentile-chart-medicare-marker"
                  className={styles.medicareMarker}
                  style={{
                    left: `${(medicareX / VIEW_WIDTH) * 100}%`,
                    top: `${medicareYPercent}%`,
                  }}
                  title="Medicare starts."
                >
                  <span className={styles.medicareIcon} aria-hidden="true">
                    +
                  </span>
                  <span className={styles.medicareLabel} aria-hidden="true">
                    Medicare starts.
                  </span>
                </button>
              )}

              {/* Active/selected-period marker (FIN-60) — bold and solid, distinct from both
                  the dashed retirement marker and the thin hover line so all three remain
                  legible when they coincide or sit near each other. */}
              {showActiveMarker && selectedX !== null && (
                <div
                  data-testid="percentile-chart-active-marker"
                  className={styles.activeMarker}
                  style={{ left: `${(selectedX / VIEW_WIDTH) * 100}%` }}
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
                    {formatAxisValue(fraction * maxValue)}
                  </div>
                ))}
              </div>

              <div className={styles.hoverTargets}>
                {rows.map((row, index) => (
                  <button
                    key={row.year}
                    type="button"
                    className={styles.hoverTarget}
                    aria-label={hoverLabel(row, series)}
                    aria-pressed={row.year === selectedYear}
                    onMouseMove={(event) => handlePointerMove(index, event)}
                    onMouseEnter={(event) => handlePointerMove(index, event)}
                    onMouseLeave={handlePointerLeave}
                    onFocus={() => setHoveredIndex(index)}
                    onBlur={handlePointerLeave}
                    onClick={() => handleSelect(index)}
                  />
                ))}
              </div>

              {hoveredRow && (
                <output className={styles.tooltip} style={tooltipStyle}>
                  <div className={styles.tooltipAge}>{periodLabel(hoveredRow)}</div>
                  {series.map((s) => (
                    <div key={s.key} className={styles.tooltipRow}>
                      <span className={styles.swatch} style={{ borderTopColor: s.color }} />{' '}
                      {formatCurrency(hoveredRow.values[s.key] ?? 0)}
                    </div>
                  ))}
                </output>
              )}
            </div>
            {showLegend && (
              <ul className={styles.legend}>
                {series.map((s) => (
                  <li key={s.key} className={styles.legendItem}>
                    <span className={styles.swatch} style={{ borderTopColor: s.color }} /> {s.label}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </figure>
    </Card>
  )
}
