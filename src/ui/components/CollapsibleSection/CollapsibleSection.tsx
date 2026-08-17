import type { ReactNode } from 'react'
import styles from './CollapsibleSection.module.css'

interface CollapsibleSectionProps {
  summary: string
  children: ReactNode
  defaultOpen?: boolean
}

export function CollapsibleSection({ summary, children, defaultOpen = false }: CollapsibleSectionProps) {
  return (
    <details className={styles.details} open={defaultOpen}>
      <summary className={styles.summary}>{summary}</summary>
      <div className={styles.content}>{children}</div>
    </details>
  )
}
