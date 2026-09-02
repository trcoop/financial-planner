import { useId } from 'react'
import styles from './TextField.module.css'

export interface TextFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
  placeholder?: string
}

/**
 * Free-text labeled input (FIN-116: Person `name`). Genuinely different semantics from
 * `NumberField` (no numeric mask/formatting, no min/max) and `SelectField` (no fixed option
 * list) — a new component per the Layout & Component System design spec's §6 reuse principle,
 * following the same label/error/`useId` pattern as `NumberField`/`Checkbox`.
 */
export function TextField({ label, value, onChange, error, placeholder }: TextFieldProps) {
  const inputId = useId()
  const errorId = useId()

  return (
    <div className={styles.field}>
      <label htmlFor={inputId} className={styles.label}>
        {label}
      </label>
      <input
        id={inputId}
        type="text"
        className={styles.input}
        value={value}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error && (
        <p id={errorId} role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  )
}
