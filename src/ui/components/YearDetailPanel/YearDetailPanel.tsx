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

/** Stable ids of the primary's and spouse's Medicare Part B events (must match
 * `src/ui/medicareEvent.ts`'s `MEDICARE_PART_B_EVENT.id` and `spouseMedicarePartBEvent`'s
 * `id`) — not imported from there to keep this file free of any Medicare-specific knowledge
 * beyond "look up these keys", matching `ChartRow.eventCosts`'s generic, stable-key shape
 * (ERD §9). FIN-114 added the spouse event but never added its id here, so its cost was
 * silently excluded from this display even though it's really deducted from the balance. */
const MEDICARE_EVENT_IDS = ['medicarePartB', 'medicareSpousePartB']

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

/** A fixed-width `Card` showing the detail for the year selected in `ChartContainer`. */
export function YearDetailPanel({ row }: YearDetailPanelProps) {
  // Sums the primary's and (if present) spouse's Medicare Part B costs into one line — the
  // panel has never had per-person breakdown, and the amount actually deducted from the
  // balance is the sum of both, so that's what this line should show.
  const medicareEntries = row?.eventCosts.filter((entry) => MEDICARE_EVENT_IDS.includes(entry.id)) ?? []
  const medicareTotal = medicareEntries.reduce((sum, entry) => sum + entry.amount, 0)

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
              {medicareEntries.length > 0 && (
                <div className={styles.row}>
                  <dt>Medicare</dt>
                  <dd>{currency.format(medicareTotal)}</dd>
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
