import type { ReactNode } from 'react'
import styles from './Table.module.css'

interface TableProps {
  children: ReactNode
  caption?: string
  /** Id of a visible heading that names the table, when a <caption> would duplicate it. */
  labelledBy?: string
}

export function Table({ children, caption, labelledBy }: TableProps) {
  return (
    <table className={styles.table} aria-labelledby={labelledBy}>
      {caption && <caption className={styles.caption}>{caption}</caption>}
      {children}
    </table>
  )
}

interface TableRowProps {
  children: ReactNode
  highlighted?: boolean
}

export function TableRow({ children, highlighted = false }: TableRowProps) {
  return (
    <tr className={styles.row} data-highlighted={highlighted ? 'true' : undefined}>
      {children}
    </tr>
  )
}
