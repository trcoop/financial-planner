import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './CalculatorPicker.module.css'

export interface CalculatorPickerOption {
  id: string
  label: string
}

export interface CalculatorPickerProps {
  /** All calculators available to switch between. */
  options: CalculatorPickerOption[]
  /** id of the currently-selected calculator. */
  selectedId: string
  /** Called with the id of the newly-picked calculator. */
  onSelect: (id: string) => void
}

const VIEWPORT_MARGIN = 8

/**
 * Header control (FIN-106) for switching between calculators — a trigger button showing the
 * current calculator's name that opens a portaled popover listbox of all calculators. This is a
 * navigation control (listbox/menu semantics), not `Tooltip`'s supplementary-info popover, so it
 * reuses `Tooltip.tsx`'s portal-rendering / viewport-aware-positioning / outside-click /
 * Escape-to-close patterns but opens on click (primary interaction) rather than hover, and adds
 * full listbox keyboard operability (roving `tabindex`/`aria-activedescendant`) that `Tooltip`
 * doesn't need. See ERD: Investment Calculator §1.
 */
export function CalculatorPicker({ options, selectedId, onSelect }: CalculatorPickerProps) {
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
    <div className={styles.container}>
      <button
        type="button"
        className={styles.trigger}
        ref={triggerRef}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? popoverId : undefined}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
      >
        {/* FIN-110: chevron is now a CSS background-image on .trigger (matches SelectField's
          * native-select chevron), not a text glyph — no markup needed for it here. */}
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
              aria-label={selectedOption ? `Choose calculator (currently ${selectedOption.label})` : 'Choose calculator'}
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
