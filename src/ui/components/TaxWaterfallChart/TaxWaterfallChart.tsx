import type { FederalTaxResult } from '../../../engine'
import { Card } from '../Card/Card'
import { StatTile } from '../StatTile/StatTile'
import { formatCurrency } from '../../utils/format'
import {
  buildIncomeSegments,
  buildTaxSegments,
  layoutSegments,
  toPixelHeight,
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
 * Originally built as a floating waterfall/bridge chart (bars resting on a zero baseline,
 * connected by dashed lines between running totals). That shape was reverse-engineered from a
 * competitor's minified bundle (a `federalTaxBreakdown` array name), never from their actual
 * rendered UI, and a real (non-technical) user reviewing it in Ladle could not tell what it showed
 * — different-colored bars with no shared meaning, a red "decrease" bar that read as an error, and
 * no combined total-tax-liability figure anywhere despite tax-owed and FICA both being present.
 *
 * This redesign drops the bridge/connector geometry for two simple "parts of a whole" bars — the
 * shape a lay reader already knows from a battery-level or storage-usage indicator: a single
 * horizontal strip whose colored sections sum to a labeled total. Each strip's segments map
 * 1-for-1 onto a row in the table below (the part the project owner said was "the useful part"),
 * so the picture explains the table instead of requiring the table to explain the picture.
 *
 * Fixed viewBox coordinate space, matching the approach `DonutChart`/`PercentileLineChart` use:
 * plot in a stable coordinate space and let the `viewBox` scale it to the rendered size.
 */
const VIEW_WIDTH = 480
const BAR_HEIGHT = 40
const BAR_GAP = 28
const ROW_LABEL_HEIGHT = 22
const FICA_BAR_HEIGHT = 18

const roleClass: Record<SegmentRole, string> = {
  base: styles.segmentBase,
  reduction: styles.segmentReduction,
  reductionBonus: styles.segmentReductionBonus,
}

export function TaxWaterfallChart({ result, title }: TaxWaterfallChartProps) {
  const grossIncome = result.grossOrdinaryIncome + result.grossPreferentialIncome
  const totalTaxLiability = result.taxOwed + result.fica.total

  const incomeSegments = buildIncomeSegments(result)
  const taxSegments = buildTaxSegments(result)

  // Each segment is clamped against its own bar's nominal total (gross income / tax before
  // credits) — a degenerate case (deductions exceeding income) can make a `reduction` segment
  // exceed that total, which `toPixelHeight` clamps rather than overflowing the bar.
  const incomeScaleMax = Math.max(1, grossIncome)
  const taxScaleMax = Math.max(1, result.taxBeforeCredits)

  const incomeBars = layoutSegments(incomeSegments, incomeScaleMax, VIEW_WIDTH)
  const taxBars = layoutSegments(taxSegments, taxScaleMax, VIEW_WIDTH)
  const ficaWidth = toPixelHeight(result.fica.total, Math.max(1, result.fica.total), VIEW_WIDTH)

  const renderRow = (
    rowLabel: string,
    rowTotal: number,
    bars: DrawnSegment[],
    y: number,
  ) => (
    <g key={rowLabel}>
      <text x={0} y={y} className={styles.rowLabel}>
        {rowLabel}: {formatCurrency(rowTotal)}
      </text>
      <g transform={`translate(0, ${y + 8})`}>
        <rect x={0} y={0} width={VIEW_WIDTH} height={BAR_HEIGHT} className={styles.barTrack} />
        {bars.map((bar) => (
          <rect
            key={bar.segment.key}
            x={bar.x}
            y={0}
            width={bar.width}
            height={BAR_HEIGHT}
            className={roleClass[bar.segment.role]}
          />
        ))}
      </g>
    </g>
  )

  const incomeRowY = ROW_LABEL_HEIGHT
  const taxRowY = incomeRowY + BAR_HEIGHT + BAR_GAP + ROW_LABEL_HEIGHT
  const ficaRowY = taxRowY + BAR_HEIGHT + BAR_GAP + ROW_LABEL_HEIGHT
  const viewHeight = ficaRowY + FICA_BAR_HEIGHT + 8

  const legendRows: { label: string; value: number; swatch?: string }[] = [
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
      <figure className={styles.figure} aria-label={title}>
        <figcaption className={styles.title}>{title}</figcaption>

        <StatTile
          label="Total tax liability (federal income tax + FICA)"
          value={formatCurrency(totalTaxLiability)}
        />

        <div className={styles.plotWrapper}>
          <svg
            className={styles.plot}
            viewBox={`0 0 ${VIEW_WIDTH} ${viewHeight}`}
            aria-hidden="true"
          >
            {renderRow('Gross income → taxable income', grossIncome, incomeBars, incomeRowY)}
            {renderRow('Tax before credits → tax owed', result.taxBeforeCredits, taxBars, taxRowY)}

            {/* FICA is deliberately drawn as its own separate, single-color bar — never chained
             * into or scaled against the income-tax bars above — because folding its dollars into
             * the same stack would misrepresent the marginal income-tax rate (ERD §8.2). */}
            <text x={0} y={ficaRowY} className={styles.rowLabel}>
              FICA: {formatCurrency(result.fica.total)}
            </text>
            <g transform={`translate(0, ${ficaRowY + 8})`}>
              <rect x={0} y={0} width={VIEW_WIDTH} height={FICA_BAR_HEIGHT} className={styles.barTrack} />
              <rect x={0} y={0} width={ficaWidth} height={FICA_BAR_HEIGHT} className={styles.segmentFica} />
            </g>
          </svg>
        </div>

        {/* Visible legend/table duplicating every value shown in the plot above, so nothing is
         * conveyed by bar position or color alone (ERD §8.2/§8.6). The color swatch in the first
         * column is purely additive — the label and formatted value alone are already sufficient
         * to read every row. No element here is interactive — there is nothing for
         * `:focus-visible`/`--focus-ring` to style yet; if an interactive affordance (e.g. a
         * hover/tap detail) is added later it must pick up `--focus-ring` at that point. */}
        <table className={styles.legend}>
          <thead>
            <tr>
              <th className={styles.legendHeader}>Segment</th>
              <th className={styles.legendHeader}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {legendRows.map((row) => (
              <tr key={row.label}>
                <td className={styles.legendLabel}>
                  {row.swatch ? <span aria-hidden="true" className={`${styles.swatch} ${row.swatch}`} /> : null}
                  {row.label}
                </td>
                <td className={styles.legendValue}>{formatCurrency(row.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figure>
    </Card>
  )
}
