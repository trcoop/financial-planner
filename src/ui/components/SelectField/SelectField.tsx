import { useId } from 'react'
import { Dropdown } from '../Dropdown/Dropdown'
import styles from './SelectField.module.css'

export interface SelectFieldOption {
  value: string
  label: string
}

interface SelectFieldProps {
  /** Visible label text. Omit for a control with no visible label (e.g. a compact nav/header
   * dropdown like the calculator switcher) — `ariaLabel` is then required so the control still
   * has an accessible name. */
  label?: string
  /** Accessible name used when there's no visible `label`. Required in that case since a control
   * with no accessible name at all is never acceptable — falls back to `label` when both are
   * given, so it's optional whenever `label` is present. */
  ariaLabel?: string
  value: string
  onChange: (value: string) => void
  options: SelectFieldOption[]
  error?: string
  /** Stretches the control to the width of its parent — the right default for a form field
   * stacked with other fields (the common case), but wrong for a compact, content-width control
   * like a header nav dropdown. Defaults to `true`; pass `false` for the content-width case. */
  fullWidth?: boolean
}

/** Shared control for small fixed-option dropdowns — both compact ones with no visible label
 * (the header's calculator switcher) and labeled form fields (compounding frequency,
 * contribution frequency, contribution timing). Renders `Dropdown` (FIN-110): a label is just
 * optional markup this field adds around it, not a defining feature — the only real difference
 * between "switch the page's calculator" and "update a form value" is what `onChange` does with
 * the picked id, which is the caller's business either way. `Dropdown`'s trigger `<button>` is a
 * labelable element per the HTML spec, so the `<label htmlFor>` association and full keyboard
 * operability this field relies on both come for free when a visible label is present. */
export function SelectField({
  label,
  ariaLabel,
  value,
  onChange,
  options,
  error,
  fullWidth = true,
}: SelectFieldProps) {
  const selectId = useId()
  const errorId = useId()
  const accessibleName = label ?? ariaLabel
  if (!accessibleName) {
    throw new Error('SelectField requires either `label` or `ariaLabel` for an accessible name.')
  }

  return (
    <div className={styles.field}>
      {label && (
        <label htmlFor={selectId} className={styles.label}>
          {label}
        </label>
      )}
      <Dropdown
        id={selectId}
        options={options.map((option) => ({ id: option.value, label: option.label }))}
        selectedId={value}
        onSelect={onChange}
        ariaLabel={accessibleName}
        fullWidth={fullWidth}
        ariaInvalid={!!error}
        ariaDescribedBy={error ? errorId : undefined}
      />
      {error && (
        <p id={errorId} role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  )
}
