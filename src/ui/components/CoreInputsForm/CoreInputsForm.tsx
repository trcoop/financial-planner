import { NumberField } from '../NumberField/NumberField'

export interface CoreInputValues {
  currentAge: number
  retirementAge: number
  initialBalance: number
  currentAnnualIncome: number
  /** Plain percentage (e.g. 15 for 15%), not a 0-1 fraction — matches the field's display. */
  annualContributionRatePercent: number
}

interface FieldSpec {
  key: keyof CoreInputValues
  label: string
  min: number
  max: number
  prefix?: string
  suffix?: string
}

const FIELDS: FieldSpec[] = [
  { key: 'currentAge', label: 'Current age', min: 18, max: 100 },
  { key: 'retirementAge', label: 'Retirement age', min: 18, max: 100 },
  { key: 'initialBalance', label: 'Current investment balance', min: 0, max: 10_000_000, prefix: '$' },
  { key: 'currentAnnualIncome', label: 'Current annual income', min: 0, max: 5_000_000, prefix: '$' },
  { key: 'annualContributionRatePercent', label: 'Annual savings percentage', min: 0, max: 100, suffix: '%' },
]

function rangeError(value: number, min: number, max: number): string | undefined {
  if (value < min || value > max) {
    return `Must be between ${min.toLocaleString()} and ${max.toLocaleString()}`
  }
  return undefined
}

interface CoreInputsFormProps {
  values: CoreInputValues
  onChange: (values: CoreInputValues) => void
}

export function CoreInputsForm({ values, onChange }: CoreInputsFormProps) {
  return (
    <form aria-label="Core financial details">
      {FIELDS.map((field) => (
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
      ))}
    </form>
  )
}
