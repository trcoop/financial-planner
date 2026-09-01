import type { KeyboardEvent } from 'react'
import { useRef } from 'react'
import styles from './TabBar.module.css'

export interface TabBarTab {
  id: string
  label: string
}

interface TabBarProps {
  tabs: TabBarTab[]
  activeTab: string
  onTabChange: (tabId: string) => void
  /** Accessible name for the `role="tablist"` container. Defaults to "Views" (the original
   * Projection/Stress Test/Profile usage). FIN-115 reuses TabBar as the mobile Profile
   * People/Accounts/Rates strip — passing a distinct label there ("Profile sections") keeps
   * the two tablists on the page distinguishable to a screen-reader user. */
  ariaLabel?: string
}

export function TabBar({ tabs, activeTab, onTabChange, ariaLabel = 'Views' }: TabBarProps) {
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  function focusTabAt(index: number) {
    const wrapped = (index + tabs.length) % tabs.length
    const tab = tabs[wrapped]
    tabRefs.current[tab.id]?.focus()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault()
        focusTabAt(index + 1)
        break
      case 'ArrowLeft':
        event.preventDefault()
        focusTabAt(index - 1)
        break
      case 'Home':
        event.preventDefault()
        focusTabAt(0)
        break
      case 'End':
        event.preventDefault()
        focusTabAt(tabs.length - 1)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        onTabChange(tabs[index].id)
        break
      default:
        break
    }
  }

  return (
    <div className={styles.tabBar} role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeTab
        return (
          <button
            key={tab.id}
            ref={(el) => {
              tabRefs.current[tab.id] = el
            }}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={isActive}
            aria-controls={`tabpanel-${tab.id}`}
            tabIndex={-1}
            className={isActive ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => onTabChange(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
