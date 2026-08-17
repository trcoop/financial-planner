import type { AdvancedAssumptionValues } from './AdvancedAssumptionsForm'

export interface AdvancedFieldRange {
  key: keyof AdvancedAssumptionValues
  min: number
  max: number
}

export const ADVANCED_FIELD_RANGES: AdvancedFieldRange[] = [
  { key: 'annualRaisePercent', min: 0, max: 100 },
  { key: 'annualReturnPercent', min: -50, max: 100 },
  { key: 'inflationPercent', min: -50, max: 100 },
  { key: 'withdrawalRatePercent', min: 0, max: 100 },
]

export function rangeError(value: number, min: number, max: number): string | undefined {
  if (value < min || value > max) {
    return `Must be between ${min.toLocaleString()} and ${max.toLocaleString()}`
  }
  return undefined
}

/**
 * True when every advanced field is within its enforced range. Mirrors
 * `isCoreInputValid` — callers combine both to decide whether to recalculate (FIN-10 AC).
 */
export function isAdvancedInputValid(values: AdvancedAssumptionValues): boolean {
  return ADVANCED_FIELD_RANGES.every((field) => rangeError(values[field.key], field.min, field.max) === undefined)
}
