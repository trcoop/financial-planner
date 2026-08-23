import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import styles from './Tooltip.module.css'

export interface TooltipProps {
  /** Accessible name for the trigger button, e.g. "Why this withdrawal rate?". */
  label: string
  children: ReactNode
}

const VIEWPORT_MARGIN = 8
/** Bridges the pointer gap between the trigger and the portaled popover below it, so moving
 * the mouse from one to the other doesn't flicker the popover closed and back open. */
const HOVER_CLOSE_DELAY_MS = 100

/** Only devices with real hover (mice, trackpads) get hover-to-open — touchscreens report
 * `(hover: hover)` as false, so tap-to-toggle (the `onClick` handler below) is their only
 * trigger. This also keeps hover inert in jsdom (no `matchMedia` support there), so tests can
 * drive the trigger with plain clicks without fighting a hover-opened state. */
function supportsHover(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover)').matches
}

/**
 * An info popover (FIN-64) that opens on hover (desktop) or tap (mobile, where there's no
 * hover) — the trigger is whichever the pointer type supports, so it works the same on both
 * without a device-detection branch. `onClick` only opens (never toggles closed): on a
 * hover-capable device the click that opens a hovered trigger already fires a `pointerenter`
 * first, so a toggling click would immediately close what hover just opened; on touch there's
 * no hover to conflict with, and open-only still gets you to "open" in one tap. Closing instead
 * happens on pointer-leave (after a short delay so crossing from the trigger onto the popover
 * itself doesn't close it), a click anywhere outside, or Escape.
 *
 * Rendered via a portal into `document.body` — it's opened from a sidebar panel
 * (`Drawer.module.css`'s `.panel`) that clips overflow for its collapse-slide animation, which
 * would otherwise cut the popover off.
 */
export function Tooltip({ label, children }: TooltipProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const closeTimeoutRef = useRef<number | undefined>(undefined)
  const popoverId = useId()

  const open = () => {
    window.clearTimeout(closeTimeoutRef.current)
    setIsOpen(true)
  }
  const scheduleClose = () => {
    window.clearTimeout(closeTimeoutRef.current)
    closeTimeoutRef.current = window.setTimeout(() => setIsOpen(false), HOVER_CLOSE_DELAY_MS)
  }
  const handlePointerEnter = () => {
    if (supportsHover()) open()
  }
  const handlePointerLeave = () => {
    if (supportsHover()) scheduleClose()
  }

  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!containerRef.current?.contains(target) && !popoverRef.current?.contains(target)) {
        setIsOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  useLayoutEffect(() => {
    if (!isOpen) {
      setPosition(null)
      return
    }

    const updatePosition = () => {
      const triggerRect = containerRef.current?.getBoundingClientRect()
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

  useEffect(() => () => window.clearTimeout(closeTimeoutRef.current), [])

  return (
    <div
      className={styles.container}
      ref={containerRef}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <button
        type="button"
        className={styles.trigger}
        aria-label={label}
        aria-expanded={isOpen}
        aria-controls={popoverId}
        onClick={() => open()}
      >
        i
      </button>
      {isOpen &&
        createPortal(
          <div
            id={popoverId}
            role="tooltip"
            ref={popoverRef}
            className={styles.popover}
            style={position ? { top: position.top, left: position.left } : { visibility: 'hidden' }}
            onPointerEnter={handlePointerEnter}
            onPointerLeave={handlePointerLeave}
          >
            {children}
          </div>,
          document.body,
        )}
    </div>
  )
}
