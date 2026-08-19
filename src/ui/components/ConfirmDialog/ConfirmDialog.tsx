import { useEffect, useId, useRef } from 'react'
import { Button } from '../Button/Button'
import styles from './ConfirmDialog.module.css'

export interface ConfirmDialogProps {
  /** Controls mounting — the dialog renders nothing when false. */
  isOpen: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * In-system replacement for `window.confirm()` (FIN-50), styled to match the
 * app's existing Card/Button design language rather than the browser chrome.
 * `role="alertdialog"` since this always represents a confirm/cancel decision
 * about a destructive action, not general content.
 */
export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const messageId = useId()

  useEffect(() => {
    if (!isOpen) return
    confirmButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onCancel])

  if (!isOpen) return null

  return (
    <div className={styles.backdrop}>
      {/* Click-outside-to-close target. Not a semantic control itself — Escape (handled
       * above) and the Cancel button both already cover the same "close without
       * confirming" action via keyboard, so this stays a plain decorative backdrop. */}
      <button
        type="button"
        className={styles.backdropButton}
        aria-hidden="true"
        tabIndex={-1}
        onClick={onCancel}
      />
      <div
        className={styles.dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
      >
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        <p id={messageId} className={styles.message}>
          {message}
        </p>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant="primary" onClick={onConfirm} ref={confirmButtonRef}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
