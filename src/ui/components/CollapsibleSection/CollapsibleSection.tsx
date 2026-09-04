import { useState, type ReactNode } from 'react'
import styles from './CollapsibleSection.module.css'

interface CollapsibleSectionProps {
  summary: string
  children: ReactNode
  defaultOpen?: boolean
  /** Optional extra class on the root `<details>` — e.g. so a consumer embedding this inside its
   * own CSS grid form can force it to span the full row instead of sharing one with a sibling
   * field. */
  className?: string
}

export function CollapsibleSection({ summary, children, defaultOpen = false, className }: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <details
      className={className ? `${styles.details} ${className}` : styles.details}
      data-open={isOpen}
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
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
