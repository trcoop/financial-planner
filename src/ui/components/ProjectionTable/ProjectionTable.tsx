import type { ProjectionRow } from '../../../engine/types'
import { formatCurrency } from '../../utils/format'
import styles from './ProjectionTable.module.css'

export interface ProjectionTableProps {
  rows: ProjectionRow[]
  /**
   * The plan's retirement age boundary (`PlanAssumptions.retirementAge`).
   *
   * Optional so this component still renders standalone (e.g. in isolation, or before the
   * orchestrating page wires it in) with the pre-FIN-12 combined header and no highlighting.
   * Once provided:
   *   - the header cell switches to "Annual Contribution ($)" or "Annual Withdrawal ($)"
   *     (see below for which), and
   *   - the retirement-transition row — the first row where `row.age >= retirementAge` — gets
   *     a `.retirementTransition` highlight class. If every row is already at or past
   *     retirement (the user is retired at the start of the projection), that's row 0. If no
   *     row reaches retirement within the projection horizon, no row is highlighted.
   */
  retirementAge?: number
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
 * FIN-12 header-label resolution: the AC describes the label switching "for all rows at or
 * after retirement age," but this is a single static header for the whole column, not a
 * per-row label. Resolved by keying the header off row 0's status — i.e. whether the plan
 * is *already* retired at the start of the projection (`rows[0].age >= retirementAge`) —
 * rather than off any later transition row. This matches the AC's explicit already-retired
 * edge case ("first row is highlighted and labeled as Annual Withdrawal") and gives a
 * single unambiguous answer for the normal case (projection starts pre-retirement, so the
 * header reads "Annual Contribution ($)" even though later rows in the same column show
 * withdrawal figures once the transition row is reached). Flagged as a judgment call on the
 * FIN-12 Linear ticket rather than left silent.
 */
export function ProjectionTable({ rows, retirementAge }: ProjectionTableProps) {
  const alreadyRetiredAtStart = retirementAge !== undefined && rows.length > 0 && rows[0].age >= retirementAge
  const contributionOrWithdrawalHeader =
    retirementAge === undefined
      ? 'Annual Contribution/Withdrawal ($)'
      : alreadyRetiredAtStart
        ? 'Annual Withdrawal ($)'
        : 'Annual Contribution ($)'

  const transitionRowIndex =
    retirementAge === undefined ? -1 : rows.findIndex((row) => row.age >= retirementAge)

  return (
    <div className={styles.scrollContainer}>
      <table className={styles.table}>
        <thead className={styles.stickyHead}>
          <tr>
            <th>Year</th>
            <th>Age</th>
            <th>Balance Start ($)</th>
            <th>{contributionOrWithdrawalHeader}</th>
            <th>Investment Return ($)</th>
            <th>Balance End ($)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const contributionOrWithdrawal = row.annualContribution !== 0 ? row.annualContribution : row.annualWithdrawal
            const isTransitionRow = index === transitionRowIndex
            return (
              <tr key={row.year} className={isTransitionRow ? styles.retirementTransition : undefined}>
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
