import { useId } from 'react'
import type { FederalTaxResult } from '../../../engine'
import { Card } from '../Card/Card'
import { StatTile } from '../StatTile/StatTile'
import { Table, TableRow } from '../Table/Table'
import { formatCurrency } from '../../utils/format'
import {
  buildIncomeSegments,
  buildSourceSegments,
  buildTaxSegments,
  layoutSegments,
  toPixelWidth,
  type DrawnSegment,
  type SegmentRole,
} from './waterfallLayout'
import styles from './TaxWaterfallChart.module.css'

export interface TaxWaterfallChartProps {
  /** The engine's computed result, imported type-only (ERD §8.2) — this component never calls
   * `computeFederalTax` itself and never imports `engine/tax/tables.ts`. Every number it draws or
   * labels comes from this object. */
  result: FederalTaxResult
  /** Shown above the chart and used as the figure's accessible name. */
  title: string
}

/**
 * Two horizontal "parts of a whole" bars (income split into deductions + taxable income; tax
 * before credits split into credits + tax owed) plus a separate FICA bar, each segment mapping
 * 1-for-1 onto a legend row below. Chosen over a floating bridge waterfall because non-technical
 * readers could not tell what the bridge showed. FICA is never chained into the income-tax bars.
 * Plots in a fixed viewBox coordinate space and lets the viewBox scale it, like `DonutChart`.
 */
const VIEW_WIDTH = 480
// Bars are drawn in a fixed-width viewBox stretched to the container (`preserveAspectRatio="none"`)
// and given a token-sized CSS height, so no text lives inside the SVG — row labels are HTML above
// each bar so type scales with the theme tokens rather than with the viewBox.
const BAR_VIEW_HEIGHT = 10

const roleClass: Record<SegmentRole, string> = {
  base: styles.segmentBase,
  reduction: styles.segmentReduction,
  reductionBonus: styles.segmentReductionBonus,
  ordinary: styles.segmentSourcesOrdinary,
  preferential: styles.segmentSourcesPreferential,
  ssTaxable: styles.segmentSourcesSsTaxable,
  ssNotTaxed: styles.segmentSourcesSsNotTaxed,
}

const sourceSwatch: Partial<Record<SegmentRole, string>> = {
  ordinary: styles.swatchOrdinary,
  preferential: styles.swatchPreferential,
  ssTaxable: styles.swatchSsTaxable,
  ssNotTaxed: styles.swatchSsNotTaxed,
}

export function TaxWaterfallChart({ result, title }: TaxWaterfallChartProps) {
  const captionId = useId()
  const grossIncome = result.grossOrdinaryIncome + result.grossPreferentialIncome
  const totalTaxLiability = result.taxOwed + result.fica.total

  const incomeSegments = buildIncomeSegments(result)
  const taxSegments = buildTaxSegments(result)

  // Each segment is clamped against its own bar's nominal total (gross income / tax before
  // credits) — a degenerate case (deductions exceeding income) can make a `reduction` segment
  // exceed that total, which `toPixelWidth` clamps rather than overflowing the bar.
  const incomeScaleMax = Math.max(1, grossIncome)
  const taxScaleMax = Math.max(1, result.taxBeforeCredits)

  const hasSocialSecurity = result.grossSocialSecurity > 0
  const sourceSegments = buildSourceSegments(result)
  const sourcesTotal = result.grossOrdinaryIncome + result.grossPreferentialIncome + result.grossSocialSecurity
  const sourceBars = layoutSegments(sourceSegments, Math.max(1, Math.round(sourcesTotal)), VIEW_WIDTH)

  const incomeBars = layoutSegments(incomeSegments, incomeScaleMax, VIEW_WIDTH)
  const taxBars = layoutSegments(taxSegments, taxScaleMax, VIEW_WIDTH)
  const ficaWidth = toPixelWidth(result.fica.total, Math.max(1, result.fica.total), VIEW_WIDTH)

  const renderBar = (bars: { key: string; x: number; width: number; cls: string }[], barClass: string) => (
    <svg
      className={`${styles.bar} ${barClass}`}
      viewBox={`0 0 ${VIEW_WIDTH} ${BAR_VIEW_HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <rect x={0} y={0} width={VIEW_WIDTH} height={BAR_VIEW_HEIGHT} className={styles.barTrack} />
      {bars.map((bar) => (
        <rect
          key={bar.key}
          x={bar.x}
          y={0}
          width={bar.width}
          height={BAR_VIEW_HEIGHT}
          className={bar.cls}
        />
      ))}
    </svg>
  )

  const renderRow = (rowLabel: string, bars: DrawnSegment[]) => (
    <div key={rowLabel} className={styles.row}>
      <div className={styles.rowLabel}>{rowLabel}</div>
      {renderBar(
        bars.map((bar) => ({
          key: bar.segment.key,
          x: bar.x,
          width: bar.width,
          cls: roleClass[bar.segment.role],
        })),
        styles.barTall,
      )}
    </div>
  )

  const sourceLegendRows: { label: string; value: number; swatch?: string }[] = hasSocialSecurity
    ? [
        ...sourceSegments.slice(0, 2).map((seg) => ({ label: seg.label, value: seg.value, swatch: sourceSwatch[seg.role] })),
        { label: 'Social Security — gross', value: Math.round(result.grossSocialSecurity) },
        ...sourceSegments.slice(2).map((seg) => ({ label: seg.label, value: seg.value, swatch: sourceSwatch[seg.role] })),
        { label: 'Total income including Social Security', value: sourcesTotal },
      ]
    : []

  const legendRows: { label: string; value: number; swatch?: string }[] = [
    ...sourceLegendRows,
    { label: 'Gross income', value: grossIncome },
    { label: 'Standard deduction', value: result.deduction.standardDeduction, swatch: styles.swatchReduction },
    {
      label: 'Senior bonus deduction',
      value: result.deduction.seniorBonusDeduction,
      swatch: styles.swatchReductionBonus,
    },
    { label: 'Taxable income', value: result.taxableIncome, swatch: styles.swatchBase },
    { label: 'Tax before credits', value: result.taxBeforeCredits },
    { label: 'Credits', value: result.credits, swatch: styles.swatchReduction },
    { label: 'Tax owed', value: result.taxOwed, swatch: styles.swatchBase },
    { label: 'FICA — Social Security', value: result.fica.socialSecurity },
    { label: 'FICA — Medicare', value: result.fica.medicare },
    { label: 'FICA — Additional Medicare', value: result.fica.additionalMedicare },
    { label: 'FICA total', value: result.fica.total, swatch: styles.swatchFica },
  ]

  return (
    <Card className={styles.card}>
      <figure className={styles.figure} aria-labelledby={captionId}>
        <figcaption id={captionId} className={styles.title}>{title}</figcaption>

        <div className={styles.body}>
          <div className={styles.plotColumn}>
            <StatTile
              label="Total tax liability (federal income tax + FICA)"
              value={formatCurrency(totalTaxLiability)}
            />

            {hasSocialSecurity
              ? renderRow(
                  `Income sources ${formatCurrency(sourcesTotal)} (Social Security ${formatCurrency(result.grossSocialSecurity)}, ${formatCurrency(result.taxableSocialSecurity)} taxed)`,
                  sourceBars,
                )
              : null}
            {renderRow(
              `Gross income ${formatCurrency(grossIncome)} → taxable income ${formatCurrency(result.taxableIncome)}`,
              incomeBars,
            )}
            {renderRow(
              `Tax before credits ${formatCurrency(result.taxBeforeCredits)} → tax owed ${formatCurrency(result.taxOwed)}`,
              taxBars,
            )}

            {/* FICA is deliberately drawn as its own separate, single-color bar — never chained
             * into or scaled against the income-tax bars above — because folding its dollars into
             * the same stack would misrepresent the marginal income-tax rate (ERD §8.2). */}
            <div className={styles.row}>
              <div className={styles.rowLabel}>FICA: {formatCurrency(result.fica.total)}</div>
              {renderBar(
                [{ key: 'fica', x: 0, width: ficaWidth, cls: styles.segmentFica }],
                styles.barShort,
              )}
            </div>
          </div>

        {/* Visible legend/table duplicating every value shown in the plot above, so nothing is
         * conveyed by bar position or color alone (ERD §8.2/§8.6). The color swatch in the first
         * column is purely additive — the label and formatted value alone are already sufficient
         * to read every row. No element here is interactive — there is nothing for
         * `:focus-visible`/`--focus-ring` to style yet; if an interactive affordance (e.g. a
         * hover/tap detail) is added later it must pick up `--focus-ring` at that point. */}
        <Table>
          <thead>
            <TableRow>
              <th scope="col">Segment</th>
              <th scope="col">Amount</th>
            </TableRow>
          </thead>
          <tbody>
            {legendRows.map((row) => (
              <TableRow key={row.label}>
                <td>
                  {row.swatch ? <span aria-hidden="true" className={`${styles.swatch} ${row.swatch}`} /> : null}
                  {row.label}
                </td>
                <td>{formatCurrency(row.value)}</td>
              </TableRow>
            ))}
          </tbody>
        </Table>
        </div>
      </figure>
    </Card>
  )
}
