import { useId } from 'react'
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

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const num = event.target.valueAsNumber
    if (Number.isFinite(num)) {
      onChange(num)
    }
  }

  return (
    <div className={styles.field}>
      <label htmlFor={inputId} className={styles.label}>
        {label}
      </label>
      <div className={styles.inputRow}>
        {prefix && (
          <span className={styles.adornment} aria-hidden="true">
            {prefix}
          </span>
        )}
        <input
          id={inputId}
          type="number"
          className={styles.input}
          value={value}
          min={min}
          max={max}
          step={step}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={handleChange}
        />
        {suffix && (
          <span className={styles.adornment} aria-hidden="true">
            {suffix}
          </span>
        )}
      </div>
      {error && (
        <p id={errorId} role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  )
}
