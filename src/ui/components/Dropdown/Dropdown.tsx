import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './Dropdown.module.css'

export interface DropdownOption {
  id: string
  label: string
}

export interface DropdownProps {
  /** All choices the user can pick between. */
  options: DropdownOption[]
  /** id of the currently-selected option. */
  selectedId: string
  /** Called with the id of the newly-picked option. */
  onSelect: (id: string) => void
  /** Id applied to the trigger button — pass this as a `<label htmlFor>` target for field use. */
  id?: string
  /** Extra class applied to the trigger button (e.g. layout overrides from a consuming field). */
  className?: string
  /**
   * Accessible name used both as the trigger's fallback label context and to build the
   * popover listbox's `aria-label` (which needs its own name distinct from the trigger's,
   * per WCAG, since it's a separate widget). E.g. "Choose calculator" or "Compounding frequency".
   */
  ariaLabel: string
  /** Stretches the trigger + container to fill the width of their parent (form-field use). */
  fullWidth?: boolean
  /** Marks the trigger invalid (error styling) and links it to an error message. */
  ariaInvalid?: boolean
  ariaDescribedBy?: string
}

const VIEWPORT_MARGIN = 8

/**
 * Generic trigger-button + portaled-popover-listbox control (FIN-106, generalized in FIN-110).
 * The single implementation behind both the header's calculator picker and SelectField's
 * form-field dropdowns (e.g. compounding frequency) — Travis's FIN-110 visual review asked for
 * one real shared component rather than two components that merely shared CSS. This is a
 * navigation/selection control (listbox/menu semantics), not `Tooltip`'s supplementary-info
 * popover, so it reuses `Tooltip.tsx`'s portal-rendering / viewport-aware-positioning /
 * outside-click / Escape-to-close patterns but opens on click (primary interaction) rather than
 * hover, and adds full listbox keyboard operability (roving `tabindex`/`aria-activedescendant`)
 * that `Tooltip` doesn't need. See ERD: Investment Calculator §1.
 */
export function Dropdown({
  options,
  selectedId,
  onSelect,
  id,
  className,
  ariaLabel,
  fullWidth,
  ariaInvalid,
  ariaDescribedBy,
}: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const listboxRef = useRef<HTMLDivElement>(null)
  const popoverId = useId()
  const optionIdPrefix = useId()

  // Falls back to the first option if `selectedId` doesn't match anything in `options` (e.g. a
  // stale id from a caller whose list changed) — this primitive doesn't validate its own props
  // (unlike src/engine/, callers are trusted here), so silently clamping is preferable to
  // rendering a blank trigger label.
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.id === selectedId),
  )
  const selectedOption = options[selectedIndex]

  const optionId = (index: number) => `${optionIdPrefix}-option-${index}`

  const close = () => {
    setIsOpen(false)
    // Closing by any path (selection, Escape, outside click) returns focus to the trigger.
    triggerRef.current?.focus()
  }

  const openAt = (index: number) => {
    setActiveIndex(index)
    setIsOpen(true)
  }

  const selectActive = () => {
    const option = options[activeIndex]
    if (option) onSelect(option.id)
    close()
  }

  const handleTriggerClick = () => {
    if (isOpen) {
      close()
    } else {
      openAt(selectedIndex)
    }
  }

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (isOpen) return
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
      event.preventDefault()
      openAt(selectedIndex)
    }
  }

  const handleListboxKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActiveIndex((index) => Math.min(index + 1, options.length - 1))
        break
      case 'ArrowUp':
        event.preventDefault()
        setActiveIndex((index) => Math.max(index - 1, 0))
        break
      case 'Home':
        event.preventDefault()
        setActiveIndex(0)
        break
      case 'End':
        event.preventDefault()
        setActiveIndex(options.length - 1)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        selectActive()
        break
      case 'Escape':
        event.preventDefault()
        close()
        break
      default:
        break
    }
  }

  // Focus the listbox itself (roving tabindex via aria-activedescendant) whenever it opens.
  useEffect(() => {
    if (isOpen) listboxRef.current?.focus()
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!triggerRef.current?.contains(target) && !popoverRef.current?.contains(target)) {
        close()
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  useLayoutEffect(() => {
    if (!isOpen) {
      setPosition(null)
      return
    }

    const updatePosition = () => {
      const triggerRect = triggerRef.current?.getBoundingClientRect()
      if (!triggerRect) return
      const popoverRect = popoverRef.current?.getBoundingClientRect()
      const popoverHeight = popoverRect?.height ?? 0
      const popoverWidth = popoverRect?.width ?? 0

      const fitsBelow = triggerRect.bottom + VIEWPORT_MARGIN + popoverHeight <= window.innerHeight
      const top = fitsBelow
        ? triggerRect.bottom + VIEWPORT_MARGIN
        : Math.max(VIEWPORT_MARGIN, triggerRect.top - VIEWPORT_MARGIN - popoverHeight)

      const maxLeft = Math.max(window.innerWidth - popoverWidth - VIEWPORT_MARGIN, VIEWPORT_MARGIN)
      const left = Math.min(Math.max(triggerRect.left, VIEWPORT_MARGIN), maxLeft)

      setPosition({ top, left })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [isOpen])

  return (
    <div className={fullWidth ? `${styles.container} ${styles.containerFullWidth}` : styles.container}>
      <button
        type="button"
        id={id}
        className={[styles.trigger, fullWidth ? styles.triggerFullWidth : '', className ?? '']
          .filter(Boolean)
          .join(' ')}
        ref={triggerRef}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? popoverId : undefined}
        // oxlint's ARIA-1.1 role table doesn't yet list `aria-invalid` as valid on `button`
        // (eslint-disable comments don't suppress this rule in oxlint), but ARIA 1.2 added it
        // for exactly this case — a custom widget standing in for a form control. SelectField
        // relies on it to mark this trigger invalid and link it to its error message, matching
        // how a native `<select>` would use it; the one resulting lint warning is expected.
        aria-invalid={ariaInvalid ? true : undefined}
        aria-describedby={ariaDescribedBy}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
      >
        {/* FIN-110: chevron is a CSS background-image on .trigger, not a text glyph — no markup
          * needed for it here. */}
        {selectedOption?.label}
      </button>
      {isOpen &&
        createPortal(
          <div
            id={popoverId}
            ref={popoverRef}
            className={styles.popover}
            style={position ? { top: position.top, left: position.left } : { visibility: 'hidden' }}
          >
            {/* A native <select>/<option> can't be portaled, positioned relative to the trigger,
                or driven by the roving-tabindex/aria-activedescendant pattern the ERD specifies
                (§1) — this custom listbox implements that pattern by hand, so the jsx-a11y lint
                suggestions below (prefer native form-control tags) don't apply here. */}
            <div
              role="listbox"
              ref={listboxRef}
              tabIndex={-1}
              className={styles.listbox}
              aria-activedescendant={optionId(activeIndex)}
              aria-label={selectedOption ? `${ariaLabel} (currently ${selectedOption.label})` : ariaLabel}
              onKeyDown={handleListboxKeyDown}
            >
              {options.map((option, index) => (
                // eslint-disable-next-line jsx-a11y/prefer-tag-over-role, jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus -- keyboard activation is handled by the listbox's onKeyDown (roving focus); this option is intentionally not independently focusable or key-handled.
                <div
                  key={option.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={option.id === selectedId}
                  className={`${styles.option} ${index === activeIndex ? styles.optionActive : ''}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => {
                    onSelect(option.id)
                    close()
                  }}
                >
                  {option.label}
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
