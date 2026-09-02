import type { CoreInputValues } from './CoreInputsForm'

export interface CoreFieldRange {
  key: keyof CoreInputValues
  min: number
  max: number
}

export const CORE_FIELD_RANGES: CoreFieldRange[] = [
  { key: 'currentAge', min: 18, max: 100 },
  { key: 'retirementAge', min: 18, max: 100 },
  { key: 'initialBalance', min: 0, max: 10_000_000 },
  { key: 'currentAnnualIncome', min: 0, max: 5_000_000 },
  { key: 'annualContributionRatePercent', min: 0, max: 100 },
]

export function rangeError(value: number, min: number, max: number): string | undefined {
  if (value < min || value > max) {
    return `Must be between ${min.toLocaleString()} and ${max.toLocaleString()}`
  }
  return undefined
}

/**
 * True when every core field is within its enforced range. Callers (e.g. `App`) use this
 * to decide whether to recalculate the projection — the form must "pause" recalculation
 * while any field is out of range rather than run the engine on an invalid value (FIN-9 AC).
 */
export function isCoreInputValid(values: CoreInputValues): boolean {
  return CORE_FIELD_RANGES.every((field) => rangeError(values[field.key], field.min, field.max) === undefined)
}
