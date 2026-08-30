import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import styles from './NumberField.module.css'

interface NumberFieldProps {
  label: string
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step?: number
  error?: string
  /** Visual adornment before the input, e.g. "$". Display only — not part of the value. */
  prefix?: string
  /** Visual adornment after the input, e.g. "%". Display only — not part of the value. */
  suffix?: string
}

/** Comma-grouped for display (e.g. 250000 -> "250,000"); not used while the field is
 * focused, since reformatting mid-edit would fight the user's cursor and keystrokes. */
function formatValue(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: 10 }) : ''
}

/** Strips anything that isn't a digit, comma, single leading minus, or single decimal
 * point — this is the field's input mask, since `type="text"` (needed for comma display)
 * loses the browser's native `type="number"` character filtering. */
function sanitize(raw: string): string {
  let s = raw.replace(/[^0-9.,-]/g, '')
  if (s.length > 0) {
    s = s[0] + s.slice(1).replace(/-/g, '')
  }
  const firstDot = s.indexOf('.')
  if (firstDot !== -1) {
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, '')
  }
  return s
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  error,
  prefix,
  suffix,
}: NumberFieldProps) {
  const inputId = useId()
  const errorId = useId()
  const [text, setText] = useState(() => formatValue(value))
  const [isFocused, setIsFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // Set by a keystroke's onChange to re-place the caret after the re-render it causes — a
  // controlled input's `value` assignment otherwise resets the caret to the end, which is
  // what made typing into a suffixed field (e.g. "15%") push the cursor out past the "%".
  const pendingCursorRef = useRef<number | null>(null)
  // True only across the mousedown->focus->mouseup of the click that focuses this field, so
  // that click's own mouseup (below) can suppress the browser's own cursor placement and
  // fall through to the same select-all a Tab-focus gets. A React state flag doesn't work
  // here because focus and mouseup are separate native events / separate render flushes.
  const focusingClickRef = useRef(false)

  useLayoutEffect(() => {
    if (pendingCursorRef.current !== null && inputRef.current) {
      inputRef.current.setSelectionRange(pendingCursorRef.current, pendingCursorRef.current)
      pendingCursorRef.current = null
    }
  })

  // Reflect external value changes into the display text, but only while the user isn't
  // actively editing — otherwise an in-flight keystroke's raw text would get clobbered by
  // the formatted version on every render.
  useEffect(() => {
    if (!isFocused) {
      setText(formatValue(value))
    }
  }, [value, isFocused])

  const prefixLength = prefix?.length ?? 0

  // Selects just the digits (`text`), leaving a prefix/suffix like "$"/"%" outside the
  // selection — so typing over a full selection can't delete or overwrite the adornment.
  function selectDigits() {
    inputRef.current?.setSelectionRange(prefixLength, prefixLength + text.length)
  }

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    // The prefix/suffix are baked into the displayed value (below), so every keystroke's
    // raw event value carries them too — strip them back off before sanitizing/parsing the
    // digits. If a keystroke ate into the prefix/suffix itself (e.g. backspacing over it),
    // it won't match here and stays stripped from `text`; re-appending it on the next render
    // is what makes it self-heal instead of becoming editable/deletable.
    let raw = event.target.value
    let cursor = event.target.selectionStart ?? raw.length
    // Only strip (and offset the cursor by) as much of the prefix as is actually still
    // there — an edit that consumes part of the prefix (e.g. a paste replacing a selection
    // that spans the prefix boundary) leaves `raw` not starting with the full prefix, so
    // `cursor` must not be decremented by more than what was actually stripped.
    const strippedPrefixLength = prefix && raw.startsWith(prefix) ? prefix.length : 0
    raw = raw.slice(strippedPrefixLength)
    cursor -= strippedPrefixLength
    if (suffix && raw.endsWith(suffix)) raw = raw.slice(0, raw.length - suffix.length)
    raw = sanitize(raw)
    cursor = Math.max(0, Math.min(cursor, raw.length))
    setText(raw)
    pendingCursorRef.current = prefixLength + cursor
    const cleaned = raw.replace(/,/g, '')
    const num = Number(cleaned)
    if (cleaned !== '' && cleaned !== '-' && Number.isFinite(num)) {
      onChange(num)
    }
  }

  // Baked directly into the input's own text (e.g. "$250,000", "15%") rather than rendered
  // as separate elements next to it — that's what makes them read as part of the number
  // instead of a floating icon, and it stays true while typing, not just at rest.
  const displayText = `${prefix ?? ''}${text}${suffix ?? ''}`

  return (
    <div className={styles.field}>
      <label htmlFor={inputId} className={styles.label}>
        {label}
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        inputMode="decimal"
        className={styles.input}
        value={displayText}
        min={min}
        max={max}
        step={step}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={handleChange}
        onFocus={() => {
          setIsFocused(true)
          selectDigits()
        }}
        onBlur={() => setIsFocused(false)}
        onMouseDown={() => {
          focusingClickRef.current = document.activeElement !== inputRef.current
        }}
        onMouseUp={(event) => {
          if (focusingClickRef.current) {
            focusingClickRef.current = false
            event.preventDefault()
            selectDigits()
          }
        }}
      />
      {error && (
        <p id={errorId} role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  )
}
