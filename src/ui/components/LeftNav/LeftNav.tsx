import type { KeyboardEvent } from 'react'
import { useRef } from 'react'
import styles from './LeftNav.module.css'

/**
 * Shared shape for a top-level app section shown in navigation (LeftNav today;
 * BottomTabBar per FIN-89 will reuse it). `icon` is accepted so callers already
 * wiring icons (see src/ui/components/icons, FIN-94) have somewhere to put them,
 * but LeftNav itself ignores it at P0 — icons render is deferred to a later ticket.
 */
export interface NavItem {
  id: string
  label: string
  icon?: React.ComponentType<{ className?: string }>
}

export interface LeftNavProps {
  items: NavItem[]
  activeId: NavItem['id']
  onSelect: (id: NavItem['id']) => void
}

/**
 * Primitive left-hand navigation for switching between top-level app sections
 * (Plan, Calculators, ...). Semantically a <nav> with plain buttons — NOT a
 * tablist — so `aria-current="page"` marks the active item rather than
 * `aria-selected`. Keyboard support is a roving-tabindex implementation
 * mirroring TabBar's (src/ui/components/TabBar/TabBar.tsx), but with
 * ArrowUp/ArrowDown (vertical list) instead of ArrowLeft/ArrowRight, plus
 * Home/End to jump to the first/last item.
 *
 * Renders each item's `icon` next to its label when provided (Direction B,
 * FIN-90 round 2), mirroring BottomTabBar's icon+label layout
 * (src/ui/components/BottomTabBar/BottomTabBar.tsx). `icon` stays optional
 * on the shared `NavItem` type — an item without one just renders label-only.
 *
 * No app-state knowledge lives here: which items exist, which is active, and
 * what happens on selection are all owned by the caller (FIN-100/FIN-89).
 */
export function LeftNav({ items, activeId, onSelect }: LeftNavProps) {
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  function focusItemAt(index: number) {
    const wrapped = (index + items.length) % items.length
    const item = items[wrapped]
    itemRefs.current[item.id]?.focus()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        focusItemAt(index + 1)
        break
      case 'ArrowUp':
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
    <nav className={styles.leftNav} aria-label="Sections">
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
            <span>{item.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
