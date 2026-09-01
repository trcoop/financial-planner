import { useId } from 'react'
import styles from './ToggleGroup.module.css'

export interface ToggleGroupOption {
  value: string
  label: string
}

interface ToggleGroupProps {
  label: string
  value: string
  onChange: (value: string) => void
  options: ToggleGroupOption[]
}

/** Segmented two-button toggle for a small, fixed set of mutually-exclusive options (e.g.
 * contribution frequency, contribution timing). Native radio semantics under the hood — full
 * keyboard operability and ARIA come for free, matching `SelectField`'s accessibility bar —
 * rendered as a segmented control since showing both options at once is faster to scan and
 * select than opening a dropdown for a binary choice. */
export function ToggleGroup({ label, value, onChange, options }: ToggleGroupProps) {
  const groupName = useId()
  const labelId = useId()

  return (
    // Plain div/span (not fieldset/legend) so this matches SelectField/NumberField's own DOM
    // shape exactly — legend's UA-default box formatting doesn't participate in normal block
    // flow the way a label does, which was throwing the toggle's row out of vertical alignment
    // with the text-field rows above/below it (round-1 visual review finding).
    <div className={styles.field}>
      <span id={labelId} className={styles.label}>
        {label}
      </span>
      <div className={styles.segments} role="radiogroup" aria-labelledby={labelId}>
        {options.map((option) => (
          <label
            key={option.value}
            className={value === option.value ? `${styles.segment} ${styles.segmentSelected}` : styles.segment}
          >
            <input
              type="radio"
              name={groupName}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className={styles.input}
            />
            {option.label}
          </label>
        ))}
      </div>
    </div>
  )
}
