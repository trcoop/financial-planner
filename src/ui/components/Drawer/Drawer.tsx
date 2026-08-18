import { useId, useState, type ReactNode } from 'react'
import styles from './Drawer.module.css'

interface DrawerProps {
  /** Accessible name for the wrapped content region. */
  label: string
  children: ReactNode
}

/** Matches the single responsive breakpoint used across the app shell. */
const DESKTOP_QUERY = '(min-width: 960px)'

/**
 * Drawer defaults open (push-content) at desktop widths and collapsed
 * (accordion) at mobile widths. This is read once at mount, mirroring the
 * uncontrolled, non-persisted state pattern used by CollapsibleSection.
 */
function getDefaultOpen(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return true
  }
  return window.matchMedia(DESKTOP_QUERY).matches
}

export function Drawer({ label, children }: DrawerProps) {
  const [isOpen, setIsOpen] = useState(getDefaultOpen)
  const contentId = useId()

  return (
    <div className={styles.drawer} data-open={isOpen}>
      <div className={styles.header}>
        {isOpen && <span className={styles.title}>{label}</span>}
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={isOpen}
          aria-controls={contentId}
          onClick={() => setIsOpen((open) => !open)}
        >
          {isOpen ? 'Collapse ◂' : 'Expand ▾'}
        </button>
      </div>
      <section
        id={contentId}
        aria-label={label}
        className={styles.content}
        hidden={!isOpen}
      >
        {children}
      </section>
    </div>
  )
}
