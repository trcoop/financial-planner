import { cleanup, render, screen } from '@testing-library/react'
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
})
