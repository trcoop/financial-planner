import { Card } from '../Card/Card'
import type { ChartRow } from '../ChartContainer/types'
import styles from './YearDetailPanel.module.css'

export interface YearDetailPanelProps {
  /**
   * The currently selected year's row, or `undefined` before any selection has been made.
   * YearDetailPanel does not own selection state itself — it is driven entirely by whatever
   * the parent passes here, typically `ChartContainer`'s `onSelectRow` callback result.
   */
  row: ChartRow | undefined
}

/** Stable id of the Medicare Part B event (must match `src/ui/medicareEvent.ts`'s
 * `MEDICARE_PART_B_EVENT.id`) — not imported from there to keep this file free of any
 * Medicare-specific knowledge beyond "look up this key", matching `ChartRow.eventCosts`'s
 * generic, stable-key shape (ERD §9). */
const MEDICARE_EVENT_ID = 'medicarePartB'

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

/** A fixed-width `Card` showing the detail for the year selected in `ChartContainer`. */
export function YearDetailPanel({ row }: YearDetailPanelProps) {
  const medicareEntry = row?.eventCosts.find((entry) => entry.id === MEDICARE_EVENT_ID)

  return (
    <Card className={styles.card}>
      <section aria-label="Year detail" className={styles.section}>
        {row && (
          <>
            <div className={styles.headline}>
              <p className={styles.headlineLabel}>
                Age {row.age} · Year {row.year + 1}
              </p>
              <p className={styles.headlineValue}>{currency.format(row.endingBalance)}</p>
            </div>
            <dl className={styles.list}>
              <div className={styles.row}>
                <dt>Balance start</dt>
                <dd>{currency.format(row.beginningBalance)}</dd>
              </div>
              <div className={styles.row}>
                <dt>Annual contribution</dt>
                <dd>{currency.format(row.annualContribution)}</dd>
              </div>
              <div className={styles.row}>
                <dt>Investment return</dt>
                <dd>{currency.format(row.investmentReturn)}</dd>
              </div>
              <div className={styles.row}>
                <dt>Annual withdrawal</dt>
                <dd>{currency.format(row.annualWithdrawal)}</dd>
              </div>
              {medicareEntry && (
                <div className={styles.row}>
                  <dt>Medicare</dt>
                  <dd>{currency.format(medicareEntry.amount)}</dd>
                </div>
              )}
              <div className={styles.row}>
                <dt>Balance end</dt>
                <dd>{currency.format(row.endingBalance)}</dd>
              </div>
            </dl>
          </>
        )}
        {/* Per the design mockup: a persistent instructional line, not a state that
           disappears once a bar's been clicked — the chart stays interactive throughout. */}
        <p className={styles.placeholder}>Click any point on the chart to see that year's detail.</p>
      </section>
    </Card>
  )
}
