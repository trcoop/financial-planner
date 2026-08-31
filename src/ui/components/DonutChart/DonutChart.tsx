import { Card } from '../Card/Card'
import { formatCurrency } from '../../utils/format'
import styles from './DonutChart.module.css'

/** One wedge of the donut, as an arbitrary label/value pair — the caller decides what the
 * segments mean (this use case: starting amount, contributions, growth for the Investment
 * Calculator's breakdown, FIN-105) and how many of them there are. Not hardcoded to three. */
export interface DonutSegment {
  label: string
  value: number
  /** Any valid CSS color (a `var(--color-*)` token is expected). Falls back to a position in
   * `DEFAULT_COLORS` (cycling if there are more segments than default colors) when omitted, so
   * callers with a natural color scheme (e.g. matching another chart's series colors) can opt in
   * without every caller having to pick colors. */
  color?: string
}

export interface DonutChartProps {
  /** The wedges to plot, in the order they're drawn (clockwise from 12 o'clock) and listed in
   * the legend. Presentational only — no `src/engine` calls happen here. */
  segments: DonutSegment[]
  /** Title shown above the chart and used as the figure's accessible name. */
  title: string
}

/** Fixed viewBox coordinate space the arcs are plotted in; scales to the rendered SVG size via
 * `viewBox` so no pixel math is needed elsewhere in this component — same approach as
 * `PercentileLineChart`'s fixed `VIEW_WIDTH`/`VIEW_HEIGHT`. */
const VIEW_SIZE = 200
const CENTER = VIEW_SIZE / 2
const OUTER_RADIUS = VIEW_SIZE / 2
/** Inner radius of the hole, as a fraction of `OUTER_RADIUS` — the visual difference between a
 * "donut" and a plain pie. */
const INNER_RADIUS = OUTER_RADIUS * 0.6

/** Default per-segment colors, cycled by index for callers that don't supply their own `color` —
 * reuses the same theme tokens `PercentileLineChart` callers already pass in
 * (`--color-primary`/`--color-success`/`--color-warning`), so a caller with exactly three
 * segments (this ticket's use case) gets a sensible default palette for free. */
const DEFAULT_COLORS = ['var(--color-primary)', 'var(--color-success)', 'var(--color-warning)', 'var(--color-error)']

const colorForIndex = (segment: DonutSegment, index: number): string =>
  segment.color ?? DEFAULT_COLORS[index % DEFAULT_COLORS.length]

/** Converts a point on the circle (given an angle in radians, measured clockwise from 12
 * o'clock) at the given radius into `x,y` viewBox coordinates. */
const pointOnCircle = (angleRadians: number, radius: number): { x: number; y: number } => ({
  x: CENTER + radius * Math.sin(angleRadians),
  y: CENTER - radius * Math.cos(angleRadians),
})

/** Builds the SVG path `d` for one donut wedge, a ring segment between `INNER_RADIUS` and
 * `OUTER_RADIUS` spanning `startAngle` to `endAngle` (radians, clockwise from 12 o'clock). */
const wedgePath = (startAngle: number, endAngle: number): string => {
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0
  const outerStart = pointOnCircle(startAngle, OUTER_RADIUS)
  const outerEnd = pointOnCircle(endAngle, OUTER_RADIUS)
  const innerEnd = pointOnCircle(endAngle, INNER_RADIUS)
  const innerStart = pointOnCircle(startAngle, INNER_RADIUS)

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${OUTER_RADIUS} ${OUTER_RADIUS} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${INNER_RADIUS} ${INNER_RADIUS} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ')
}

/**
 * A hand-rolled-SVG donut/pie chart primitive — no charting library, matching
 * `PercentileLineChart`'s existing approach and the app's zero-network-calls constraint (FIN-105).
 *
 * General-purpose over an arbitrary `DonutSegment[]`, not hardcoded to any fixed count — the
 * Investment Calculator's breakdown (starting amount / contributions / growth) is the first
 * caller, with three segments, but this component doesn't assume that shape.
 *
 * Renders a visible legend listing every segment's label and formatted currency value alongside
 * its color swatch, so the breakdown is never conveyed by color alone (accessibility
 * requirement) — a color-blind or screen-reader user gets the same information a sighted user
 * reading the chart's colors would.
 */
export function DonutChart({ segments, title }: DonutChartProps) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0)

  let cursorAngle = 0
  const wedges = segments
    .map((segment, index) => {
      const fraction = total > 0 ? segment.value / total : 0
      const startAngle = cursorAngle
      const endAngle = cursorAngle + fraction * 2 * Math.PI
      cursorAngle = endAngle
      return { segment, index, startAngle, endAngle }
    })
    // A zero-value segment spans no angle and would draw a degenerate (invisible, but still
    // present) path — skip it from the drawn arcs while still listing it in the legend below, so
    // the legend always reflects every segment the caller passed regardless of value.
    .filter(({ startAngle, endAngle }) => endAngle > startAngle)

  return (
    <Card className={styles.card}>
      <figure className={styles.figure} aria-label={title}>
        <figcaption className={styles.title}>{title}</figcaption>

        {segments.length > 0 && (
          <>
            <div className={styles.plotWrapper}>
              <svg
                className={styles.plot}
                viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`}
                aria-hidden="true"
              >
                {wedges.map(({ segment, index, startAngle, endAngle }) => (
                  <path
                    key={segment.label}
                    d={wedgePath(startAngle, endAngle)}
                    fill={colorForIndex(segment, index)}
                    className={styles.wedge}
                  />
                ))}
              </svg>
            </div>

            <ul className={styles.legend}>
              {segments.map((segment, index) => (
                <li key={segment.label} className={styles.legendItem}>
                  <span
                    className={styles.swatch}
                    style={{ backgroundColor: colorForIndex(segment, index) }}
                    aria-hidden="true"
                  />
                  <span className={styles.legendLabel}>{segment.label}</span>
                  <span className={styles.legendValue}>{formatCurrency(segment.value)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </figure>
    </Card>
  )
}
