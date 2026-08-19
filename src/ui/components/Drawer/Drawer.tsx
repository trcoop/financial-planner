import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
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
  // Once the user explicitly toggles the drawer, their choice wins over the
  // responsive default for the rest of this mount — the listener below only
  // re-applies the breakpoint default until then, so a rotate/resize before
  // any manual interaction picks up the correct default retroactively.
  const userToggled = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }
    const mediaQueryList = window.matchMedia(DESKTOP_QUERY)
    const handleChange = (event: MediaQueryListEvent) => {
      if (!userToggled.current) {
        setIsOpen(event.matches)
      }
    }
    mediaQueryList.addEventListener('change', handleChange)
    return () => mediaQueryList.removeEventListener('change', handleChange)
  }, [])

  return (
    <div className={styles.drawer} data-open={isOpen}>
      {/* Sits outside .panel (see CSS module) so it never moves with the pane's
       * off-canvas slide — a persistent tab that's always the way back in. Icon-only
       * per product feedback (a text label read as inconsistent chrome); the chevron
       * itself flips via CSS based on data-open, so this markup doesn't branch on
       * isOpen at all. */}
      <button
        type="button"
        className={styles.tab}
        aria-expanded={isOpen}
        aria-controls={contentId}
        aria-label={isOpen ? `Collapse ${label}` : `Expand ${label}`}
        onClick={() => {
          userToggled.current = true
          setIsOpen((open) => !open)
        }}
      >
        <svg
          className={styles.icon}
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="M10 3L5 8L10 13"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <div className={styles.panel}>
        <div className={styles.header}>
          <span className={styles.title}>{label}</span>
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
    </div>
  )
}
