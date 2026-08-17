import { NumberField } from '../NumberField/NumberField'
import { CORE_FIELD_RANGES, rangeError } from './validation'

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

const LABELS: Record<keyof CoreInputValues, string> = {
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

const FIELDS: FieldSpec[] = CORE_FIELD_RANGES.map((range) => ({
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
