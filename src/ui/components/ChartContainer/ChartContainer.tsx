import { useState } from 'react'
import { Card } from '../Card/Card'
import styles from './ChartContainer.module.css'
import type { ChartRow } from './types'

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
   * from this callback, seeded from `rows.at(-1)` to mirror ChartContainer's own default.
   */
  onSelectRow?: (row: ChartRow) => void
}

/**
 * A `Card`-based bar chart: one bar per year, height proportional to `endingBalance`.
 * Clicking/tapping a bar selects that year (default: the last year in `rows`) and reports
 * the selection via `onSelectRow`.
 */
export function ChartContainer({ rows, title, onSelectRow }: ChartContainerProps) {
  const [selectedYear, setSelectedYear] = useState<number | undefined>(() => rows.at(-1)?.year)

  const maxBalance = Math.max(1, ...rows.map((row) => row.endingBalance))

  const handleSelect = (row: ChartRow) => {
    setSelectedYear(row.year)
    onSelectRow?.(row)
  }

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
        <figcaption className={styles.title}>{title}</figcaption>
        <div className={styles.plot}>
          {rows.map((row) => {
            const heightPercent = (row.endingBalance / maxBalance) * 100
            const isSelected = row.year === selectedYear
            return (
              <button
                key={row.year}
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
      </figure>
    </Card>
  )
}
