import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { PercentileLineChart, type PercentileChartRow } from './PercentileLineChart'

const rows: PercentileChartRow[] = [
  { age: 35, year: 0, p10: 80_000, p50: 110_000, p90: 160_000 },
  { age: 36, year: 1, p10: 90_000, p50: 130_000, p90: 200_000 },
  { age: 37, year: 2, p10: 100_000, p50: 160_000, p90: 260_000 },
]

describe('PercentileLineChart', () => {
  afterEach(() => cleanup())

  it('renders a titled figure', () => {
    render(<PercentileLineChart rows={rows} title="Monte Carlo outcomes" />)
    expect(screen.getByRole('figure', { name: 'Monte Carlo outcomes' })).toBeInTheDocument()
  })

  it('renders an age range subtitle spanning the first and last row ages', () => {
    render(<PercentileLineChart rows={rows} title="Monte Carlo outcomes" />)
    expect(screen.getByText('Age 35 → 37')).toBeInTheDocument()
  })

  it('renders three polylines — p10, p50, and p90 — each with one point per row', () => {
    const { container } = render(<PercentileLineChart rows={rows} title="Monte Carlo outcomes" />)
    const polylines = container.querySelectorAll('polyline')
    expect(polylines).toHaveLength(3)
    for (const polyline of polylines) {
      const points = polyline.getAttribute('points')?.trim().split(/\s+/) ?? []
      expect(points).toHaveLength(rows.length)
    }
  })

  it('renders a legend labeling all three percentile lines, including the median', () => {
    render(<PercentileLineChart rows={rows} title="Monte Carlo outcomes" />)
    expect(screen.getByText(/90th percentile/i)).toBeInTheDocument()
    expect(screen.getByText(/median.*50th percentile/i)).toBeInTheDocument()
    expect(screen.getByText(/10th percentile/i)).toBeInTheDocument()
  })

  it('renders no subtitle, no polylines, and no legend when rows is empty', () => {
    const { container } = render(<PercentileLineChart rows={[]} title="Monte Carlo outcomes" />)
    expect(screen.queryByText(/^Age /)).not.toBeInTheDocument()
    expect(container.querySelectorAll('polyline')).toHaveLength(0)
    expect(screen.queryByText(/percentile/i)).not.toBeInTheDocument()
  })

  it('orders the p50 line so it renders after (visually on top of) the p10/p90 lines', () => {
    const { container } = render(<PercentileLineChart rows={rows} title="Monte Carlo outcomes" />)
    const polylines = Array.from(container.querySelectorAll('polyline'))
    const p50Index = polylines.findIndex((el) => el.className.baseVal.includes('p50Line'))
    const p10Index = polylines.findIndex((el) => el.className.baseVal.includes('p10Line'))
    const p90Index = polylines.findIndex((el) => el.className.baseVal.includes('p90Line'))
    expect(p50Index).toBeGreaterThan(p10Index)
    expect(p50Index).toBeGreaterThan(p90Index)
  })

  it('shows no tooltip before any point is hovered', () => {
    render(<PercentileLineChart rows={rows} title="Monte Carlo outcomes" />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows a tooltip with age and p10/p50/p90 values on hovering a point (FIN-47)', async () => {
    const user = userEvent.setup()
    render(<PercentileLineChart rows={rows} title="Monte Carlo outcomes" />)

    await user.hover(screen.getByLabelText('Age 36: 10th percentile $90,000, median $130,000, 90th percentile $200,000'))

    const tooltip = screen.getByRole('status')
    expect(tooltip).toHaveTextContent('Age 36')
    expect(tooltip).toHaveTextContent('$90,000')
    expect(tooltip).toHaveTextContent('$130,000')
    expect(tooltip).toHaveTextContent('$200,000')
  })

  it('hides the tooltip again after unhovering', async () => {
    const user = userEvent.setup()
    render(<PercentileLineChart rows={rows} title="Monte Carlo outcomes" />)

    const target = screen.getByLabelText('Age 36: 10th percentile $90,000, median $130,000, 90th percentile $200,000')
    await user.hover(target)
    expect(screen.getByRole('status')).toBeInTheDocument()

    await user.unhover(target)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('renders a permanent retirement-year marker when retirementAge matches a row (FIN-47)', () => {
    render(<PercentileLineChart rows={rows} title="Monte Carlo outcomes" retirementAge={36} />)
    expect(screen.getByTestId('percentile-chart-retirement-marker')).toBeInTheDocument()
  })

  it('renders no retirement marker when retirementAge is omitted or matches no row', () => {
    const { rerender } = render(<PercentileLineChart rows={rows} title="Monte Carlo outcomes" />)
    expect(screen.queryByTestId('percentile-chart-retirement-marker')).not.toBeInTheDocument()

    rerender(<PercentileLineChart rows={rows} title="Monte Carlo outcomes" retirementAge={99} />)
    expect(screen.queryByTestId('percentile-chart-retirement-marker')).not.toBeInTheDocument()
  })

  it('renders evenly-spaced y-axis gridline labels showing formatted dollar amounts (FIN-47)', () => {
    render(<PercentileLineChart rows={rows} title="Monte Carlo outcomes" />)
    const labels = screen.getAllByTestId('percentile-chart-y-axis-label')
    expect(labels.length).toBeGreaterThanOrEqual(3)
    for (const label of labels) {
      expect(label).toHaveTextContent(/^\$[\d,]+$/)
    }
  })

  it('rounds a just-over-$1M y-axis label to the nearest $100k as a full number, not an abbreviation (FIN-47)', () => {
    const highRows: PercentileChartRow[] = [
      { age: 60, year: 0, p10: 900_000, p50: 1_050_000, p90: 1_180_000 },
    ]
    render(<PercentileLineChart rows={highRows} title="Monte Carlo outcomes" />)
    const labels = screen.getAllByTestId('percentile-chart-y-axis-label')
    // top gridline == maxValue == 1,180,000, rounds to nearest 100k => $1,200,000
    expect(labels[0]).toHaveTextContent('$1,200,000')
  })

  it('abbreviates a comfortably-multi-million y-axis label to one decimal of millions (FIN-47)', () => {
    const highRows: PercentileChartRow[] = [
      { age: 60, year: 0, p10: 3_000_000, p50: 4_500_000, p90: 5_186_787 },
    ]
    render(<PercentileLineChart rows={highRows} title="Monte Carlo outcomes" />)
    const labels = screen.getAllByTestId('percentile-chart-y-axis-label')
    expect(labels[0]).toHaveTextContent('$5.2M')
  })
})
