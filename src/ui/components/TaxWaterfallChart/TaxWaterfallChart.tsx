import type { FederalTaxResult } from '../../../engine'
import { Card } from '../Card/Card'
import { formatCurrency } from '../../utils/format'
import { buildSegments, layoutGroup, toPixelHeight, type DrawnBar } from './waterfallLayout'
import styles from './TaxWaterfallChart.module.css'

export interface TaxWaterfallChartProps {
  /** The engine's computed result, imported type-only (ERD §8.2) — this component never calls
   * `computeFederalTax` itself and never imports `engine/tax/tables.ts`. Every number it draws or
   * labels comes from this object. */
  result: FederalTaxResult
  /** Shown above the chart and used as the figure's accessible name. */
  title: string
}

/** Fixed viewBox coordinate space, matching the approach `DonutChart`/`PercentileLineChart` use:
 * plot in a stable coordinate space and let the `viewBox` scale it to the rendered size. */
const VIEW_WIDTH = 640
const VIEW_HEIGHT = 220
const BASELINE_Y = 190
const BAND_HEIGHT = 150
const BAR_WIDTH = 56
const GROUP_GAP = 36
const FICA_GAP = 48

export function TaxWaterfallChart({ result, title }: TaxWaterfallChartProps) {
  const segments = buildSegments(result)
  const incomeSegments = segments.filter((s) => s.group === 'income')
  const taxSegments = segments.filter((s) => s.group === 'tax')

  const incomeBars = layoutGroup(incomeSegments, 0, BAR_WIDTH)
  const taxGroupStartX = incomeBars.length * BAR_WIDTH + GROUP_GAP
  const taxBars = layoutGroup(taxSegments, taxGroupStartX, BAR_WIDTH)
  const ficaX = taxGroupStartX + taxBars.length * BAR_WIDTH + FICA_GAP

  // Each group is scaled against its own largest magnitude — income dollars and tax dollars are
  // wildly different scales, so sharing one scale would make the tax-side bars imperceptible.
  const incomeScaleMax = Math.max(1, ...incomeBars.map((b) => b.rangeHigh))
  const taxScaleMax = Math.max(1, ...taxBars.map((b) => b.rangeHigh))
  const ficaScaleMax = Math.max(1, result.fica.total)

  const renderBar = (bar: DrawnBar, scaleMax: number) => {
    const topPx = toPixelHeight(bar.rangeHigh, scaleMax, BAND_HEIGHT)
    const bottomPx = toPixelHeight(bar.rangeLow, scaleMax, BAND_HEIGHT)
    const y = BASELINE_Y - topPx
    const height = Math.max(0, topPx - bottomPx)
    const isSubtotal = bar.segment.kind !== 'decrease'
    return (
      <rect
        key={bar.segment.key}
        x={bar.x}
        y={y}
        width={BAR_WIDTH - 8}
        height={height}
        className={isSubtotal ? styles.barTotal : styles.barDecrease}
      />
    )
  }

  const renderConnector = (from: DrawnBar, to: DrawnBar, scaleMax: number) => {
    // Connect the resting edge of `from` (its rangeLow when it fell, its rangeHigh when it's a
    // rising total/subtotal) to the start of `to`.
    const connectorValue = from.segment.kind === 'decrease' ? from.rangeLow : from.rangeHigh
    const y = BASELINE_Y - toPixelHeight(connectorValue, scaleMax, BAND_HEIGHT)
    return (
      <line
        key={`${from.segment.key}-${to.segment.key}`}
        x1={from.x + BAR_WIDTH - 8}
        y1={y}
        x2={to.x}
        y2={y}
        className={styles.connector}
      />
    )
  }

  const ficaHeight = toPixelHeight(result.fica.total, ficaScaleMax, BAND_HEIGHT)

  const legendRows: { label: string; value: number }[] = [
    ...segments.map((s) => ({ label: s.label, value: s.value })),
    { label: 'FICA — Social Security', value: result.fica.socialSecurity },
    { label: 'FICA — Medicare', value: result.fica.medicare },
    { label: 'FICA — Additional Medicare', value: result.fica.additionalMedicare },
    { label: 'FICA total', value: result.fica.total },
  ]

  return (
    <Card className={styles.card}>
      <figure className={styles.figure} aria-label={title}>
        <figcaption className={styles.title}>{title}</figcaption>

        <div className={styles.plotWrapper}>
          <svg
            className={styles.plot}
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            aria-hidden="true"
          >
            <line
              x1={0}
              y1={BASELINE_Y}
              x2={ficaX + BAR_WIDTH}
              y2={BASELINE_Y}
              className={styles.baseline}
            />

            {incomeBars.map((bar) => renderBar(bar, incomeScaleMax))}
            {incomeBars.slice(0, -1).map((bar, i) => renderConnector(bar, incomeBars[i + 1], incomeScaleMax))}

            {taxBars.map((bar) => renderBar(bar, taxScaleMax))}
            {taxBars.slice(0, -1).map((bar, i) => renderConnector(bar, taxBars[i + 1], taxScaleMax))}

            {/* FICA is deliberately drawn as its own separate bar, never chained into the
             * waterfall's running total — folding it in would misrepresent the marginal
             * income-tax rate (ERD §8.2). */}
            <rect
              x={ficaX}
              y={BASELINE_Y - ficaHeight}
              width={BAR_WIDTH - 8}
              height={ficaHeight}
              className={styles.barFica}
            />
          </svg>
        </div>

        {/* Visible legend/table duplicating every value shown in the plot above, so nothing is
         * conveyed by bar position or color alone (ERD §8.2/§8.6). No element here is
         * interactive — there is nothing for `:focus-visible`/`--focus-ring` to style yet; if an
         * interactive affordance (e.g. a hover/tap detail) is added later it must pick up
         * `--focus-ring` at that point. */}
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
                <td className={styles.legendLabel}>{row.label}</td>
                <td className={styles.legendValue}>{formatCurrency(row.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figure>
    </Card>
  )
}
