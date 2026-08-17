import type { ProjectionRow } from '../../../engine/types'
import { formatCurrency } from '../../utils/format'
import styles from './ProjectionTable.module.css'

export interface ProjectionTableProps {
  rows: ProjectionRow[]
}

/**
 * Year-by-year projection breakdown table.
 *
 * Uses its own <table> markup rather than the generic `Table`/`TableRow` primitives:
 * a fixed header on vertical scroll needs a sticky `<thead>` inside a max-height,
 * overflow-y scroll container, which those primitives (a bare `<table>` wrapper with no
 * `<thead>` concept) don't support cleanly.
 *
 * Sign convention: the combined "Annual Contribution/Withdrawal" column shows whichever
 * of `annualContribution` / `annualWithdrawal` is nonzero, always as a plain positive
 * number — the engine guarantees exactly one is nonzero per row (contribution is always
 * 0 in retirement, withdrawal is always 0 pre-retirement). No +/- sign or color coding is
 * applied; the column header alone reflects that this is a combined figure.
 *
 * FIN-12 will extend this component to highlight retirement-transition rows and to swap
 * the header label (e.g. "Annual Contribution ($)" pre-retirement / "Annual Withdrawal
 * ($)" in retirement) once a retirement-age boundary is threaded through as a prop. The
 * header cell below is kept as a single, easily-swappable JSX expression for that reason.
 */
export function ProjectionTable({ rows }: ProjectionTableProps) {
  return (
    <div className={styles.scrollContainer}>
      <table className={styles.table}>
        <thead className={styles.stickyHead}>
          <tr>
            <th>Year</th>
            <th>Age</th>
            <th>Balance Start ($)</th>
            {/* FIN-12: swap this static label for a dynamic one at the retirement transition. */}
            <th>Annual Contribution/Withdrawal ($)</th>
            <th>Investment Return ($)</th>
            <th>Balance End ($)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const contributionOrWithdrawal = row.annualContribution !== 0 ? row.annualContribution : row.annualWithdrawal
            return (
              <tr key={row.year}>
                <td>{row.year + 1}</td>
                <td>{row.age}</td>
                <td>{formatCurrency(row.beginningBalance)}</td>
                <td>{formatCurrency(contributionOrWithdrawal)}</td>
                <td>{formatCurrency(row.investmentReturn)}</td>
                <td>{formatCurrency(row.endingBalance)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
