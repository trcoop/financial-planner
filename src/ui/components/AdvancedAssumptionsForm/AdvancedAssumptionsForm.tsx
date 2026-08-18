import { CollapsibleSection } from '../CollapsibleSection/CollapsibleSection'
import { NumberField } from '../NumberField/NumberField'
import { ADVANCED_FIELD_RANGES, rangeError } from './validation'
import styles from './AdvancedAssumptionsForm.module.css'

export interface AdvancedAssumptionValues {
  /** Plain percentage (e.g. 3 for 3%), not a 0-1 fraction — matches the field's display. */
  annualRaisePercent: number
  annualReturnPercent: number
  inflationPercent: number
  withdrawalRatePercent: number
}

interface FieldSpec {
  key: keyof AdvancedAssumptionValues
  label: string
  min: number
  max: number
  suffix?: string
}

const LABELS: Record<keyof AdvancedAssumptionValues, string> = {
  annualRaisePercent: 'Expected annual raise',
  annualReturnPercent: 'Investment return assumption',
  inflationPercent: 'Inflation rate',
  withdrawalRatePercent: 'Withdrawal rate in retirement',
}

const FIELDS: FieldSpec[] = ADVANCED_FIELD_RANGES.map((range) => ({
  key: range.key,
  label: LABELS[range.key],
  min: range.min,
  max: range.max,
  suffix: '%',
}))

interface AdvancedAssumptionsFormProps {
  values: AdvancedAssumptionValues
  onChange: (values: AdvancedAssumptionValues) => void
}

export function AdvancedAssumptionsForm({ values, onChange }: AdvancedAssumptionsFormProps) {
  return (
    <CollapsibleSection summary="▸ Advanced assumptions">
      <form aria-label="Advanced assumptions" className={styles.form}>
        {FIELDS.map((field) => (
          <NumberField
            key={field.key}
            label={field.label}
            value={values[field.key]}
            min={field.min}
            max={field.max}
            suffix={field.suffix}
            error={rangeError(values[field.key], field.min, field.max)}
            onChange={(value) => onChange({ ...values, [field.key]: value })}
          />
        ))}
      </form>
    </CollapsibleSection>
  )
}
