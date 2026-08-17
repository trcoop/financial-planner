import { useEffect, useId, useState } from 'react'
import styles from './NumberField.module.css'

interface NumberFieldProps {
  label: string
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step?: number
  error?: string
}

export function NumberField({ label, value, onChange, min, max, step = 1, error }: NumberFieldProps) {
  const inputId = useId()
  const errorId = useId()
  const [inputValue, setInputValue] = useState(value)

  useEffect(() => {
    setInputValue(value)
  }, [value])

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const num = event.target.valueAsNumber
    setInputValue(num)
    onChange(num)
  }

  return (
    <div className={styles.field}>
      <label htmlFor={inputId} className={styles.label}>
        {label}
      </label>
      <input
        id={inputId}
        type="number"
        className={styles.input}
        value={inputValue}
        min={min}
        max={max}
        step={step}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={handleChange}
      />
      {error && (
        <p id={errorId} role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  )
}
