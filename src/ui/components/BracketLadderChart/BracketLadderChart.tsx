import type { BracketOccupancy, FederalTaxResult } from '../../../engine'
import { Card } from '../Card/Card'
import { formatCurrency, formatPercent } from '../../utils/format'
import styles from './BracketLadderChart.module.css'

export interface BracketLadderChartProps {
  /** The engine's own output — the chart never recomputes bracket boundaries itself (ERD §8.4).
   * Imported type-only, same precedent as `ProjectionTable`'s `ProjectionRow[]`. */
  result: FederalTaxResult
  /** Title shown above the chart and used as the figure's accessible name. */
  title: string
  /** Renders the preferential (LTCG/qualified dividend) ladder as a second stack beside the
   * ordinary one (ERD §8.3, the PRD's P1). Adding this prop is the Design Spec §6 reuse call —
   * a second component would just be this one with a mode flag. */
  showPreferential?: boolean
}

/** Fixed viewBox coordinate space each stack is plotted in, scaled to the rendered size via
 * `viewBox` — same approach as `DonutChart`/`PercentileLineChart`. */
const VIEW_WIDTH = 300
const BAND_HEIGHT = 28
const BAND_GAP = 6
/** Vertical space reserved above each band for its own rate/range label (ERD §8.3: "per-band
 * rate/bound labels" belong on the chart itself, not only in the table below it) — labels sit in
 * this strip rather than on top of the band rects so they stay legible against the card
 * background regardless of whether the band underneath is filled, empty, or mid-fraction. */
const LABEL_HEIGHT = 14
const ROW_HEIGHT = LABEL_HEIGHT + BAND_HEIGHT + BAND_GAP

/** A band's fill fraction, in `[0, 1]`. The top band's `upperBound` is `Infinity`, so there is no
 * dollar-denominated width to divide by — per ERD §8.3 it gets a synthetic extent rather than an
 * attempt to scale to infinity: fully filled once any income lands in it, otherwise empty, same
 * as every other unoccupied band. */
function fillFraction(band: BracketOccupancy): number {
  if (band.upperBound === Infinity) {
    return band.incomeInThisBracket > 0 ? 1 : 0
  }
  const width = band.upperBound - band.lowerBound
  if (width <= 0) return 0
  return Math.max(0, Math.min(1, band.incomeInThisBracket / width))
}

/** `"$50,000 – $100,000"` for a closed band, `"$100,000 and up"` for the open-ended top band. */
function boundsLabel(band: BracketOccupancy): string {
  if (band.upperBound === Infinity) {
    return `${formatCurrency(band.lowerBound)} and up`
  }
  return `${formatCurrency(band.lowerBound)} – ${formatCurrency(band.upperBound)}`
}

interface LadderStackProps {
  bands: readonly BracketOccupancy[]
  /** The rate of the band the marginal marker points at — `ordinaryBracketRate` for the ordinary
   * stack. The preferential stack has no equivalent marker (there is no single "preferential
   * bracket rate" concept in the result), so it's optional and omitted there. */
  markerRate?: number
  fillColor: string
  stackLabel: string
  captionId: string
}

function LadderStack({ bands, markerRate, fillColor, stackLabel, captionId }: LadderStackProps) {
  const viewHeight = bands.length * ROW_HEIGHT - BAND_GAP

  return (
    <div className={styles.stack} data-stack={stackLabel}>
      <h3 className={styles.stackTitle} id={captionId}>
        {stackLabel === 'preferential' ? 'Preferential (capital gains) ladder' : 'Ordinary income ladder'}
      </h3>

      <svg
        className={styles.plot}
        viewBox={`0 0 ${VIEW_WIDTH} ${viewHeight}`}
        aria-hidden="true"
      >
        {bands.map((band, index) => {
          const rowTop = index * ROW_HEIGHT
          const labelY = rowTop + LABEL_HEIGHT - 3
          const y = rowTop + LABEL_HEIGHT
          const fraction = fillFraction(band)
          const isMarkerBand = markerRate !== undefined && band.rate === markerRate
          // Nudged off the exact left edge so an empty (fraction === 0) marginal band's dashed
          // line reads as a deliberate call-out rather than a stray pixel on the track's own
          // left border (this happens for real — see PreferentialHeavy, where the ordinary
          // ladder is entirely unoccupied but still carries the marginal-rate marker).
          const markerX = Math.max(fraction * VIEW_WIDTH, 1.5)

          return (
            <g key={`${band.lowerBound}-${band.rate}`}>
              <text
                data-role="band-label"
                x={2}
                y={labelY}
                className={styles.bandLabel}
              >
                {formatPercent(band.rate * 100)} · {boundsLabel(band)}
              </text>
              {isMarkerBand ? (
                <text
                  data-role="marker-label"
                  x={VIEW_WIDTH - 2}
                  y={labelY}
                  textAnchor="end"
                  className={styles.markerLabel}
                >
                  Marginal bracket
                </text>
              ) : (
                band.incomeInThisBracket > 0 && (
                  <text
                    data-role="band-income-label"
                    x={VIEW_WIDTH - 2}
                    y={labelY}
                    textAnchor="end"
                    className={styles.bandIncomeLabel}
                  >
                    {formatCurrency(band.incomeInThisBracket)} taxed here
                  </text>
                )
              )}
              <rect
                data-role="band-track"
                x={0}
                y={y}
                width={VIEW_WIDTH}
                height={BAND_HEIGHT}
                className={styles.track}
              />
              <rect
                data-role="band-fill"
                x={0}
                y={y}
                width={fraction * VIEW_WIDTH}
                height={BAND_HEIGHT}
                fill={fillColor}
              />
              {isMarkerBand && (
                <line
                  data-role="marginal-marker"
                  x1={markerX}
                  x2={markerX}
                  y1={y - BAND_GAP / 2}
                  y2={y + BAND_HEIGHT + BAND_GAP / 2}
                  className={styles.marker}
                />
              )}
            </g>
          )
        })}
      </svg>

      <table className={styles.table} aria-labelledby={captionId}>
        <thead>
          <tr>
            <th scope="col">Rate</th>
            <th scope="col">Range</th>
            <th scope="col">Income in band</th>
            <th scope="col">Tax from band</th>
          </tr>
        </thead>
        <tbody>
          {bands.map((band) => (
            <tr key={`${band.lowerBound}-${band.rate}`}>
              <td>{formatPercent(band.rate * 100)}</td>
              <td>{boundsLabel(band)}</td>
              <td>{formatCurrency(band.incomeInThisBracket)}</td>
              <td>{formatCurrency(Math.round(band.taxFromThisBracket))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * A hand-rolled-SVG stacked bracket ladder — one horizontal band per tax bracket, each with a
 * proportional fill for the income that landed in it. Unoccupied bands (above the taxpayer's
 * marginal band) still render at full height with zero fill — that emptiness is the
 * conversion-headroom visual the whole component exists for (ERD §8.3), which is why every
 * value is also duplicated in the table below: a broken color token would otherwise make a
 * genuinely empty band indistinguishable from a band whose fill color silently failed to
 * resolve (ERD §8.6).
 *
 * `showPreferential` renders the preferential (LTCG/qualified dividend) ladder as a second
 * stack alongside the ordinary one, reusing this same component rather than a parallel one
 * (Design Spec §6).
 */
export function BracketLadderChart({ result, title, showPreferential = false }: BracketLadderChartProps) {
  const ordinaryCaptionId = `bracket-ladder-ordinary-${title.replace(/\s+/g, '-')}`
  const preferentialCaptionId = `bracket-ladder-preferential-${title.replace(/\s+/g, '-')}`

  return (
    <Card className={styles.card}>
      <figure className={styles.figure} aria-label={title}>
        <figcaption className={styles.title}>{title}</figcaption>

        <p className={styles.annotation}>
          Marginal statutory rate: <strong>{formatPercent(result.ordinaryBracketRate * 100)}</strong>
          {' · '}
          Effective marginal rate: <strong>{formatPercent(result.effectiveMarginalRate * 100)}</strong>
        </p>

        {/* What the color/pattern of every band means, spelled out in text (never color-only) —
         * the gap that made the sibling TaxWaterfallChart read as "a bunch of bars, I don't know
         * what they mean." Every value here is also in the table below; this just orients the
         * reader before they get there. */}
        <ul className={styles.legend}>
          <li className={styles.legendItem}>
            <span className={styles.swatch} style={{ background: 'var(--color-primary)' }} />
            Ordinary income taxed in this band
          </li>
          <li className={styles.legendItem}>
            <span className={styles.swatch} data-variant="track" />
            Unused headroom — bracket not yet reached
          </li>
          <li className={styles.legendItem}>
            <span className={styles.swatch} data-variant="marker" />
            Marginal bracket (statutory rate)
          </li>
          {showPreferential && result.preferentialBrackets && (
            <li className={styles.legendItem}>
              <span className={styles.swatch} style={{ background: 'var(--color-success)' }} />
              Preferential (capital gains) income taxed in this band
            </li>
          )}
        </ul>

        <LadderStack
          bands={result.ordinaryBrackets}
          markerRate={result.ordinaryBracketRate}
          fillColor="var(--color-primary)"
          stackLabel="ordinary"
          captionId={ordinaryCaptionId}
        />

        {showPreferential && result.preferentialBrackets && (
          <LadderStack
            bands={result.preferentialBrackets}
            fillColor="var(--color-success)"
            stackLabel="preferential"
            captionId={preferentialCaptionId}
          />
        )}
      </figure>
    </Card>
  )
}
