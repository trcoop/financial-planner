import { useId } from 'react'
import styles from './SelectField.module.css'

export interface SelectFieldOption {
  value: string
  label: string
}

interface SelectFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  options: SelectFieldOption[]
  error?: string
}

/** Small shared control for fixed small-option dropdowns (e.g. compounding frequency,
 * contribution frequency, contribution timing). Native `<select>` semantics are used
 * deliberately — full keyboard operability and ARIA come for free rather than needing a
 * custom-rendered listbox, per the accessibility bar this matches from `NumberField`. */
export function SelectField({ label, value, onChange, options, error }: SelectFieldProps) {
  const selectId = useId()
  const errorId = useId()

  return (
    <div className={styles.field}>
      <label htmlFor={selectId} className={styles.label}>
        {label}
      </label>
      <select
        id={selectId}
        className={styles.select}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && (
        <p id={errorId} role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  )
}
