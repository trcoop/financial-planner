import type { FederalTaxResult } from '../../../engine'

/**
 * Pure layout/geometry math for `TaxWaterfallChart`, split into its own module (not
 * `TaxWaterfallChart.tsx`) so that file exports components only — a file mixing component and
 * non-component exports breaks React Fast Refresh (oxlint's `react/only-export-components`).
 * None of this imports React; it is plain data transformation, independently unit-testable.
 */

export type SegmentKind = 'total' | 'decrease' | 'subtotal'
export type SegmentGroup = 'income' | 'tax'

export interface WaterfallSegment {
  key: string
  label: string
  /** The true dollar magnitude for this segment, always shown in the legend/table even when the
   * drawn bar is clamped for a degenerate (income-below-deduction) case. */
  value: number
  kind: SegmentKind
  group: SegmentGroup
}

/** Builds the ordered waterfall segments for the income side (gross income through taxable
 * income) and the tax side (tax before credits through tax owed) — ERD §8.2's segment list, with
 * the deduction split into its two sub-segments so the senior bonus is never taught as part of
 * the standard deduction. */
export function buildSegments(result: FederalTaxResult): WaterfallSegment[] {
  const grossIncome = result.grossOrdinaryIncome + result.grossPreferentialIncome

  return [
    { key: 'grossIncome', label: 'Gross income', value: grossIncome, kind: 'total', group: 'income' },
    {
      key: 'standardDeduction',
      label: 'Standard deduction',
      value: result.deduction.standardDeduction,
      kind: 'decrease',
      group: 'income',
    },
    {
      key: 'seniorBonusDeduction',
      label: 'Senior bonus deduction',
      value: result.deduction.seniorBonusDeduction,
      kind: 'decrease',
      group: 'income',
    },
    { key: 'taxableIncome', label: 'Taxable income', value: result.taxableIncome, kind: 'subtotal', group: 'income' },
    {
      key: 'taxBeforeCredits',
      label: 'Tax before credits',
      value: result.taxBeforeCredits,
      kind: 'total',
      group: 'tax',
    },
    { key: 'credits', label: 'Credits', value: result.credits, kind: 'decrease', group: 'tax' },
    { key: 'taxOwed', label: 'Tax owed', value: result.taxOwed, kind: 'subtotal', group: 'tax' },
  ]
}

export interface DrawnBar {
  segment: WaterfallSegment
  /** Dollar range this bar spans, BEFORE clamping for drawing — used for the connector lines. */
  rangeLow: number
  rangeHigh: number
  x: number
}

/** Walks one group's segments building a running total (the standard waterfall algorithm): a
 * `total`/`subtotal` bar rests on zero, a `decrease` bar floats from the running value down by
 * its magnitude. Degenerate cases (a deduction exceeding gross income) can drive the running
 * value negative between segments — that is a real, correctly-computed intermediate value, not a
 * bug, so it is kept for the connector math and only clamped at draw time. */
export function layoutGroup(segments: WaterfallSegment[], startX: number, barWidth: number): DrawnBar[] {
  let running = 0
  let x = startX
  const bars: DrawnBar[] = []

  for (const segment of segments) {
    let low: number
    let high: number
    if (segment.kind === 'decrease') {
      const start = running
      const end = running - segment.value
      low = Math.min(start, end)
      high = Math.max(start, end)
      running = end
    } else {
      low = Math.min(0, segment.value)
      high = Math.max(0, segment.value)
      running = segment.value
    }
    bars.push({ segment, rangeLow: low, rangeHigh: high, x })
    x += barWidth
  }

  return bars
}

/** Converts a dollar value on `[0, scaleMax]` into a pixel height within `bandHeight`, clamping
 * negative or over-scale values so a degenerate case still draws a valid (if flat) bar rather
 * than a rect with a negative height or one that overflows the plot.
 *
 * For every real `FederalTaxResult` this clamp is provably unreachable — every dollar figure the
 * engine returns is non-negative by contract, so the values this function is ever called with in
 * practice never require clamping. It is defense-in-depth against a future contract violation
 * (a hand-built or mutated result, or a future field that isn't guaranteed non-negative), and is
 * unit-tested directly here rather than only through rendering, since real engine data can't
 * exercise the clamp. */
export function toPixelHeight(dollars: number, scaleMax: number, bandHeight: number): number {
  if (scaleMax <= 0) return 0
  const clamped = Math.max(0, Math.min(dollars, scaleMax))
  return (clamped / scaleMax) * bandHeight
}
