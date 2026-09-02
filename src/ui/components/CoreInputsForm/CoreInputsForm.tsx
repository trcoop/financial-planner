import { NumberField } from '../NumberField/NumberField'
import { CORE_FIELD_RANGES, rangeError } from './validation'
import styles from './CoreInputsForm.module.css'

export interface CoreInputValues {
  currentAge: number
  retirementAge: number
  initialBalance: number
  currentAnnualIncome: number
  /** Plain percentage (e.g. 15 for 15%), not a 0-1 fraction — matches the field's display. */
  annualContributionRatePercent: number
}

/** The core numeric fields driven by `FIELDS`/`CORE_FIELD_RANGES`. */
type CoreNumericFieldKey = keyof CoreInputValues

interface FieldSpec {
  key: CoreNumericFieldKey
  label: string
  min: number
  max: number
  prefix?: string
  suffix?: string
}

const LABELS: Record<CoreNumericFieldKey, string> = {
  currentAge: 'Current age',
  retirementAge: 'Retirement age',
  initialBalance: 'Current investment balance',
  currentAnnualIncome: 'Current annual income',
  annualContributionRatePercent: 'Annual savings percentage',
}

const ADORNMENTS: Partial<Record<keyof CoreInputValues, { prefix?: string; suffix?: string }>> = {
  initialBalance: { prefix: '$' },
  currentAnnualIncome: { prefix: '$' },
  annualContributionRatePercent: { suffix: '%' },
}

// FIN-116: currentAge/retirementAge/currentAnnualIncome are now edited via the People tab's
// primary Person fields (age/retirementAge/salary) and synced into CoreInputValues by
// PlanSection (see `syncCoreWithPrimary`) — they must not be rendered a second time here.
// CORE_FIELD_RANGES stays exhaustive over all 5 keys since it's still used to validate the
// synced values.
const RENDERED_FIELD_KEYS: CoreNumericFieldKey[] = ['initialBalance', 'annualContributionRatePercent']

const FIELDS: FieldSpec[] = CORE_FIELD_RANGES.filter((range) =>
  RENDERED_FIELD_KEYS.includes(range.key),
).map((range) => ({
  key: range.key,
  label: LABELS[range.key],
  min: range.min,
  max: range.max,
  ...ADORNMENTS[range.key],
}))

interface CoreInputsFormProps {
  values: CoreInputValues
  onChange: (values: CoreInputValues) => void
}

export function CoreInputsForm({ values, onChange }: CoreInputsFormProps) {
  const renderField = (field: FieldSpec) => (
    <NumberField
      key={field.key}
      label={field.label}
      value={values[field.key]}
      min={field.min}
      max={field.max}
      prefix={field.prefix}
      suffix={field.suffix}
      error={rangeError(values[field.key], field.min, field.max)}
      onChange={(value) => onChange({ ...values, [field.key]: value })}
    />
  )

  return (
    <form aria-label="Core financial details" className={styles.form}>
      {FIELDS.map(renderField)}
    </form>
  )
}
