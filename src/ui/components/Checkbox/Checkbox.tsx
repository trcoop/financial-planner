import { useId } from 'react'
import styles from './Checkbox.module.css'

interface CheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}

/** Boolean toggle primitive (FIN-111). A native `<input type="checkbox">` with an associated
 * `<label>` — genuinely different semantics from `SelectField`/`NumberField` (a two-state toggle,
 * not a value picker), so it's a new component rather than a variant of either per the Layout &
 * Component System design spec's §6 reuse principle. Visible focus comes from the app-wide
 * `:focus-visible` rule in theme.css, same as every other control in the library. */
export function Checkbox({ checked, onChange, label }: CheckboxProps) {
  const inputId = useId()

  return (
    <div className={styles.field}>
      <input
        id={inputId}
        type="checkbox"
        className={styles.input}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <label htmlFor={inputId} className={styles.label}>
        {label}
      </label>
    </div>
  )
}
