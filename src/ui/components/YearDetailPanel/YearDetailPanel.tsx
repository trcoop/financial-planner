import { CardStub as Card } from '../ChartContainer/CardStub'
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

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

/** A fixed-width `Card` showing the detail for the year selected in `ChartContainer`. */
export function YearDetailPanel({ row }: YearDetailPanelProps) {
  return (
    <Card className={styles.card}>
      <section aria-label="Year detail" className={styles.section}>
        {row ? (
          <dl className={styles.list}>
            <div className={styles.row}>
              <dt>Year</dt>
              <dd>{row.year + 1}</dd>
            </div>
            <div className={styles.row}>
              <dt>Age</dt>
              <dd>{row.age}</dd>
            </div>
            <div className={styles.row}>
              <dt>Balance start</dt>
              <dd>{currency.format(row.beginningBalance)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Contribution</dt>
              <dd>{currency.format(row.annualContribution)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Investment return</dt>
              <dd>{currency.format(row.investmentReturn)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Balance end</dt>
              <dd>{currency.format(row.endingBalance)}</dd>
            </div>
          </dl>
        ) : (
          <p className={styles.placeholder}>Select a year in the chart to see its detail.</p>
        )}
      </section>
    </Card>
  )
}
