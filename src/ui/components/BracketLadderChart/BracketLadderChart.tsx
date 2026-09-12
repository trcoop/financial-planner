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
  const viewHeight = bands.length * (BAND_HEIGHT + BAND_GAP) - BAND_GAP

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
          const y = index * (BAND_HEIGHT + BAND_GAP)
          const fraction = fillFraction(band)
          const isMarkerBand = markerRate !== undefined && band.rate === markerRate

          return (
            <g key={`${band.lowerBound}-${band.rate}`}>
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
                  x1={fraction * VIEW_WIDTH}
                  x2={fraction * VIEW_WIDTH}
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
