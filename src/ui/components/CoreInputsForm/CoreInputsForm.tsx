import { Checkbox } from '../Checkbox/Checkbox'
import { NumberField } from '../NumberField/NumberField'
import { CORE_FIELD_RANGES, rangeError, SPOUSE_AGE_RANGE } from './validation'
import styles from './CoreInputsForm.module.css'

export interface CoreInputValues {
  currentAge: number
  retirementAge: number
  initialBalance: number
  currentAnnualIncome: number
  /** Plain percentage (e.g. 15 for 15%), not a 0-1 fraction — matches the field's display. */
  annualContributionRatePercent: number
  hasSpouse: boolean
  /** Only meaningful when `hasSpouse` is true. Preserved (not cleared) when `hasSpouse` is
   * toggled off, so re-checking restores the previously entered value. */
  spouseAge?: number
}

/** Seeded into `spouseAge` when the spouse checkbox is checked and no age has been entered yet. */
const DEFAULT_SPOUSE_AGE = 35

/** The core numeric fields driven by `FIELDS`/`CORE_FIELD_RANGES` — excludes `hasSpouse`
 * (boolean, its own `Checkbox`) and `spouseAge` (conditionally rendered, its own `NumberField`
 * below) since neither fits this fixed 1:1 numeric-field-per-row layout. */
type CoreNumericFieldKey = Exclude<keyof CoreInputValues, 'hasSpouse' | 'spouseAge'>

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

export const DEFAULT_CORE_VALUES: CoreInputValues = {
  currentAge: 35,
  // 65 (FIN-64): traditional/Medicare-eligibility retirement age, and paired with the fixed
  // 100 planning horizon end age gives a round 35-year retirement — see
  // AdvancedAssumptionsForm's DEFAULT_ADVANCED_VALUES.withdrawalRatePercent for the
  // withdrawal rate that horizon implies.
  retirementAge: 65,
  initialBalance: 250000,
  currentAnnualIncome: 85000,
  annualContributionRatePercent: 15,
  hasSpouse: false,
  spouseAge: undefined,
}

export function CoreInputsForm({ values, onChange }: CoreInputsFormProps) {
  return (
    <form aria-label="Core financial details" className={styles.form}>
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
      <Checkbox
        label="Has a spouse"
        checked={values.hasSpouse}
        onChange={(checked) =>
          onChange({
            ...values,
            hasSpouse: checked,
            spouseAge: checked && values.spouseAge === undefined ? DEFAULT_SPOUSE_AGE : values.spouseAge,
          })
        }
      />
      {values.hasSpouse && (
        <NumberField
          label="Spouse's age"
          value={values.spouseAge ?? DEFAULT_SPOUSE_AGE}
          min={SPOUSE_AGE_RANGE.min}
          max={SPOUSE_AGE_RANGE.max}
          error={rangeError(values.spouseAge ?? DEFAULT_SPOUSE_AGE, SPOUSE_AGE_RANGE.min, SPOUSE_AGE_RANGE.max)}
          onChange={(value) => onChange({ ...values, spouseAge: value })}
        />
      )}
    </form>
  )
}
