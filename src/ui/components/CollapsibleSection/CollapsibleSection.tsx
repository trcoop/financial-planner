import { useState, type ReactNode } from 'react'
import styles from './CollapsibleSection.module.css'

interface CollapsibleSectionProps {
  summary: string
  children: ReactNode
  defaultOpen?: boolean
}

export function CollapsibleSection({ summary, children, defaultOpen = false }: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <details className={styles.details} data-open={isOpen} open={isOpen} onToggle={(event) => setIsOpen(event.currentTarget.open)}>
      <summary className={styles.summary}>
        <span className={styles.icon} aria-hidden="true">
          ▸
        </span>{' '}
        {summary}
      </summary>
      <div className={styles.content}>{children}</div>
    </details>
  )
}
