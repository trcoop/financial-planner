import type { KeyboardEvent } from 'react'
import { useRef } from 'react'
import type { NavItem } from '../LeftNav/LeftNav'
import styles from './BottomTabBar.module.css'

export interface BottomTabBarProps {
  items: NavItem[]
  activeId: NavItem['id']
  onSelect: (id: NavItem['id']) => void
}

/**
 * Primitive bottom tab bar for switching between top-level app sections on
 * mobile (Plan, Calculators, ...). Mirrors LeftNav
 * (src/ui/components/LeftNav/LeftNav.tsx): a <nav> with plain buttons — NOT
 * a tablist — so `aria-current="page"` marks the active item rather than
 * `aria-selected`. Keyboard support is the same roving-tabindex
 * implementation as LeftNav, but with ArrowLeft/ArrowRight (horizontal bar)
 * instead of ArrowUp/ArrowDown, plus Home/End to jump to the first/last item.
 *
 * Unlike LeftNav, `icon` is required here and rendered alongside the label.
 *
 * No app-state knowledge lives here: which items exist, which is active, and
 * what happens on selection are all owned by the caller. Mounting this
 * component only below the mobile breakpoint is FIN-100's job, not this
 * component's.
 */
export function BottomTabBar({ items, activeId, onSelect }: BottomTabBarProps) {
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  function focusItemAt(index: number) {
    const wrapped = (index + items.length) % items.length
    const item = items[wrapped]
    itemRefs.current[item.id]?.focus()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault()
        focusItemAt(index + 1)
        break
      case 'ArrowLeft':
        event.preventDefault()
        focusItemAt(index - 1)
        break
      case 'Home':
        event.preventDefault()
        focusItemAt(0)
        break
      case 'End':
        event.preventDefault()
        focusItemAt(items.length - 1)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        onSelect(items[index].id)
        break
      default:
        break
    }
  }

  return (
    <nav className={styles.bottomTabBar} aria-label="Sections">
      {items.map((item, index) => {
        const isActive = item.id === activeId
        const Icon = item.icon
        return (
          <button
            key={item.id}
            ref={(el) => {
              itemRefs.current[item.id] = el
            }}
            type="button"
            aria-current={isActive ? 'page' : undefined}
            tabIndex={isActive ? 0 : -1}
            className={isActive ? `${styles.item} ${styles.itemActive}` : styles.item}
            onClick={() => onSelect(item.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {Icon ? <Icon className={styles.icon} /> : null}
            <span className={styles.label}>{item.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
