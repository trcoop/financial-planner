import { Card } from '../Card/Card'
import type { ChartBandRow } from '../ChartContainer/types'
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

const toPoints = (rows: PercentileChartRow[], key: 'p10' | 'p50' | 'p90', maxValue: number): string => {
  const lastIndex = Math.max(rows.length - 1, 1)
  return rows
    .map((row, index) => {
      const x = (index / lastIndex) * VIEW_WIDTH
      const y = VIEW_HEIGHT - (row[key] / maxValue) * VIEW_HEIGHT
      return `${x},${y}`
    })
    .join(' ')
}

/**
 * A `Card`-based line chart plotting the Monte Carlo 10th/50th/90th percentile balance paths
 * over time — one line each, distinct from `ChartContainer`'s deterministic-plan bar chart
 * (FIN-47: the two were previously overlaid on one chart, which read as a confusing extra "bar
 * segment" with no legend; they're now split into separate views entirely). Includes a legend
 * so p10/p50/p90 are distinguishable at a glance, unlike the overlay it replaces.
 */
export function PercentileLineChart({ rows, title }: PercentileLineChartProps) {
  const firstAge = rows.at(0)?.age
  const lastAge = rows.at(-1)?.age
  const maxValue = Math.max(1, ...rows.map((row) => row.p90))

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
