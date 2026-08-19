import type { AdvancedAssumptionValues } from './AdvancedAssumptionsForm'

export interface AdvancedFieldRange {
  key: keyof AdvancedAssumptionValues
  min: number
  max: number
}

export const ADVANCED_FIELD_RANGES: AdvancedFieldRange[] = [
  { key: 'annualRaisePercent', min: 0, max: 100 },
  { key: 'annualReturnPercent', min: -50, max: 100 },
  // Same range as annualReturnPercent (FIN-57): the "same UI treatment/validation style as
  // the existing Stock return assumption field" per the ticket's scope. Ordered immediately
  // after annualReturnPercent (FIN-58) so the stock/bond pair reads together in the form.
  { key: 'bondReturnPercent', min: -50, max: 100 },
  { key: 'inflationPercent', min: -50, max: 100 },
  { key: 'withdrawalRatePercent', min: 0, max: 100 },
  // 1-99, not 0-100: the engine's `validateAllocation` rejects a zero weight on either leg
  // (ALLOCATION_ZERO_WEIGHT), so the UI range keeps both stocks and bonds always positive.
  { key: 'stocksAllocationPercent', min: 1, max: 99 },
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
