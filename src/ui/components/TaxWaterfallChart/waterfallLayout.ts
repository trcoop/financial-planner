import type { FederalTaxResult } from '../../../engine'

/**
 * Pure layout/geometry math for `TaxWaterfallChart`, split into its own module (not
 * `TaxWaterfallChart.tsx`) so that file exports components only — a file mixing component and
 * non-component exports breaks React Fast Refresh (oxlint's `react/only-export-components`).
 * None of this imports React; it is plain data transformation, independently unit-testable.
 *
 * The chart itself is two horizontal "part of a whole" bars (not a floating waterfall/bridge —
 * see the doc comment on `TaxWaterfallChart.tsx` for why that shape was replaced), so the layout
 * primitive here is "a total split into ordered proportional segments," reused for both the
 * income→taxable-income bar and the tax-before-credits→tax-owed bar.
 */

export type SegmentRole = 'base' | 'reduction' | 'reductionBonus'

export interface WaterfallSegment {
  key: string
  label: string
  /** The true dollar magnitude for this segment, always shown in the legend/table even when the
   * drawn segment is clamped for a degenerate (income-below-deduction) case. */
  value: number
  /** `base` is the amount that remains/carries forward (drawn in the primary blue); `reduction`
   * is an amount subtracted out of the bar's total (drawn in a green "this lowers what you owe"
   * shade); `reductionBonus` is the same family at a lighter tint, used only for the senior bonus
   * deduction so it never looks identical to the standard deduction it sits beside. Never a
   * floating/negative bar — every segment renders as a simple non-negative width of the same
   * horizontal strip. */
  role: SegmentRole
}

/** Builds the ordered segments for the income bar (gross income split into taxable income +
 * deductions) — ERD §8.2's segment list, with the deduction split into its two sub-segments so
 * the senior bonus is never taught as part of the standard deduction. Order is deductions first,
 * taxable income last, so reading left-to-right mirrors "what got carved out, then what's left." */
export function buildIncomeSegments(result: FederalTaxResult): WaterfallSegment[] {
  return [
    {
      key: 'standardDeduction',
      label: 'Standard deduction',
      value: result.deduction.standardDeduction,
      role: 'reduction',
    },
    {
      key: 'seniorBonusDeduction',
      label: 'Senior bonus deduction',
      value: result.deduction.seniorBonusDeduction,
      role: 'reductionBonus',
    },
    { key: 'taxableIncome', label: 'Taxable income', value: result.taxableIncome, role: 'base' },
  ]
}

/** Builds the ordered segments for the tax bar (tax before credits split into tax owed +
 * credits). */
export function buildTaxSegments(result: FederalTaxResult): WaterfallSegment[] {
  return [
    { key: 'credits', label: 'Credits', value: result.credits, role: 'reduction' },
    { key: 'taxOwed', label: 'Tax owed', value: result.taxOwed, role: 'base' },
  ]
}

export interface DrawnSegment {
  segment: WaterfallSegment
  x: number
  width: number
}

/** Lays out a group of segments left-to-right as proportional widths of `totalWidth`, scaled
 * against `scaleMax` (the bar's nominal total, e.g. gross income). Each segment's pixel width is
 * independently clamped via `toPixelHeight` (the same scale-and-clamp primitive used for the
 * vertical FICA bar) so a degenerate case — e.g. deductions exceeding gross income — still draws
 * valid, non-overflowing rects rather than negative or over-wide ones; the segments simply won't
 * sum to the full bar width in that case, which is itself an honest signal that deductions
 * consumed all (or more than) the income. */
export function layoutSegments(
  segments: WaterfallSegment[],
  scaleMax: number,
  totalWidth: number,
): DrawnSegment[] {
  let x = 0
  const bars: DrawnSegment[] = []
  for (const segment of segments) {
    const width = toPixelHeight(segment.value, scaleMax, totalWidth)
    bars.push({ segment, x, width })
    x += width
  }
  return bars
}

/** Converts a dollar value on `[0, scaleMax]` into a pixel extent within `bandExtent` (used for
 * both bar widths and the FICA bar's height), clamping negative or over-scale values so a
 * degenerate case still draws a valid (if flat/full) shape rather than one with a negative size or
 * one that overflows its band.
 *
 * For every real `FederalTaxResult` this clamp is provably unreachable for most fields — every
 * dollar figure the engine returns is non-negative by contract — but a deduction segment CAN
 * legitimately exceed its bar's `scaleMax` (gross income) when deductions exceed income, which is
 * why the clamp is load-bearing here, not just defense-in-depth, and is unit-tested directly. */
export function toPixelHeight(dollars: number, scaleMax: number, bandExtent: number): number {
  if (scaleMax <= 0) return 0
  const clamped = Math.max(0, Math.min(dollars, scaleMax))
  return (clamped / scaleMax) * bandExtent
}
