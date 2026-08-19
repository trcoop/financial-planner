import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PercentileLineChart, type LineChartRow, type LineChartSeries } from './PercentileLineChart'

const rows: LineChartRow[] = [
  { age: 35, year: 0, values: { p10: 80_000, p50: 110_000, p90: 160_000 } },
  { age: 36, year: 1, values: { p10: 90_000, p50: 130_000, p90: 200_000 } },
  { age: 37, year: 2, values: { p10: 100_000, p50: 160_000, p90: 260_000 } },
]

const percentileSeries: LineChartSeries[] = [
  { key: 'p90', label: '90th percentile', color: 'green' },
  { key: 'p50', label: 'Median (50th percentile)', color: 'blue' },
  { key: 'p10', label: '10th percentile', color: 'orange' },
]

const planRows: LineChartRow[] = [
  { age: 35, year: 0, values: { balance: 100_000 } },
  { age: 36, year: 1, values: { balance: 120_000 } },
]

const planSeries: LineChartSeries[] = [{ key: 'balance', label: 'Balance', color: 'blue' }]

describe('PercentileLineChart', () => {
  afterEach(() => cleanup())

  it('renders a titled figure', () => {
    render(<PercentileLineChart rows={rows} series={percentileSeries} title="Monte Carlo outcomes" />)
    expect(screen.getByRole('figure', { name: 'Monte Carlo outcomes' })).toBeInTheDocument()
  })

  it('renders an age range subtitle spanning the first and last row ages', () => {
    render(<PercentileLineChart rows={rows} series={percentileSeries} title="Monte Carlo outcomes" />)
    expect(screen.getByText('Age 35 → 37')).toBeInTheDocument()
  })

  it('renders one polyline per series, each with one point per row', () => {
    const { container } = render(
      <PercentileLineChart rows={rows} series={percentileSeries} title="Monte Carlo outcomes" />,
    )
    const polylines = container.querySelectorAll('polyline')
    expect(polylines).toHaveLength(3)
    for (const polyline of polylines) {
      const points = polyline.getAttribute('points')?.trim().split(/\s+/) ?? []
      expect(points).toHaveLength(rows.length)
    }
  })

  it("colors each series' polyline with its own color", () => {
    const { container } = render(
      <PercentileLineChart rows={rows} series={percentileSeries} title="Monte Carlo outcomes" />,
    )
    const polylines = Array.from(container.querySelectorAll('polyline'))
    expect(polylines.map((el) => el.style.stroke)).toEqual(['green', 'blue', 'orange'])
  })

  it('renders one shaded area polygon per series, in each series color', () => {
    const { container } = render(
      <PercentileLineChart rows={rows} series={percentileSeries} title="Monte Carlo outcomes" />,
    )
    const polygons = Array.from(container.querySelectorAll('polygon'))
    expect(polygons).toHaveLength(3)
    expect(polygons.map((el) => el.style.fill)).toEqual(['green', 'blue', 'orange'])
  })

  it('renders a single line, area, and no legend for a single-series (Plan) chart', () => {
    const { container } = render(
      <PercentileLineChart rows={planRows} series={planSeries} title="Investment balance by year" showLegend={false} />,
    )
    expect(container.querySelectorAll('polyline')).toHaveLength(1)
    expect(container.querySelectorAll('polygon')).toHaveLength(1)
    expect(screen.queryByText('Balance')).not.toBeInTheDocument()
  })

  it('renders a legend labeling all lines by default', () => {
    render(<PercentileLineChart rows={rows} series={percentileSeries} title="Monte Carlo outcomes" />)
    expect(screen.getByText(/90th percentile/i)).toBeInTheDocument()
    expect(screen.getByText(/median.*50th percentile/i)).toBeInTheDocument()
    expect(screen.getByText(/10th percentile/i)).toBeInTheDocument()
  })

  it('hides the legend when showLegend is false', () => {
    render(<PercentileLineChart rows={rows} series={percentileSeries} title="Monte Carlo outcomes" showLegend={false} />)
    expect(screen.queryByText(/90th percentile/i)).not.toBeInTheDocument()
  })

  it('renders no subtitle, no polylines, and no legend when rows is empty', () => {
    const { container } = render(
      <PercentileLineChart rows={[]} series={percentileSeries} title="Monte Carlo outcomes" />,
    )
    expect(screen.queryByText(/^Age /)).not.toBeInTheDocument()
    expect(container.querySelectorAll('polyline')).toHaveLength(0)
    expect(screen.queryByText(/percentile/i)).not.toBeInTheDocument()
  })

  it('shows no tooltip before any point is hovered', () => {
    render(<PercentileLineChart rows={rows} series={percentileSeries} title="Monte Carlo outcomes" />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows a tooltip with age and each series value on hovering a point', async () => {
    const user = userEvent.setup()
    render(<PercentileLineChart rows={rows} series={percentileSeries} title="Monte Carlo outcomes" />)

    await user.hover(screen.getByLabelText(/^Age 36:/))

    const tooltip = screen.getByRole('status')
    expect(tooltip).toHaveTextContent('Age 36')
    expect(tooltip).toHaveTextContent('$90,000')
    expect(tooltip).toHaveTextContent('$130,000')
    expect(tooltip).toHaveTextContent('$200,000')
  })

  it('hides the tooltip again after unhovering', async () => {
    const user = userEvent.setup()
    render(<PercentileLineChart rows={rows} series={percentileSeries} title="Monte Carlo outcomes" />)

    const target = screen.getByLabelText(/^Age 36:/)
    await user.hover(target)
    expect(screen.getByRole('status')).toBeInTheDocument()

    await user.unhover(target)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('renders a permanent retirement-year marker when retirementAge matches a row', () => {
    render(<PercentileLineChart rows={rows} series={percentileSeries} title="Monte Carlo outcomes" retirementAge={36} />)
    expect(screen.getByTestId('percentile-chart-retirement-marker')).toBeInTheDocument()
  })

  it('renders no retirement marker when retirementAge is omitted or matches no row', () => {
    const { rerender } = render(
      <PercentileLineChart rows={rows} series={percentileSeries} title="Monte Carlo outcomes" />,
    )
    expect(screen.queryByTestId('percentile-chart-retirement-marker')).not.toBeInTheDocument()

    rerender(<PercentileLineChart rows={rows} series={percentileSeries} title="Monte Carlo outcomes" retirementAge={99} />)
    expect(screen.queryByTestId('percentile-chart-retirement-marker')).not.toBeInTheDocument()
  })

  it('renders no active-period marker until a default or click sets one', () => {
    render(<PercentileLineChart rows={rows} series={percentileSeries} title="Monte Carlo outcomes" />)
    expect(screen.queryByTestId('percentile-chart-active-marker')).not.toBeInTheDocument()
  })

  it('renders an active-period marker for defaultSelectedYear', () => {
    render(
      <PercentileLineChart rows={rows} series={percentileSeries} title="Monte Carlo outcomes" defaultSelectedYear={1} />,
    )
    expect(screen.getByTestId('percentile-chart-active-marker')).toBeInTheDocument()
  })

  it('sets the active-period marker and calls onSelectRow when a time slice is clicked', async () => {
    const user = userEvent.setup()
    const onSelectRow = vi.fn()
    render(
      <PercentileLineChart
        rows={rows}
        series={percentileSeries}
        title="Monte Carlo outcomes"
        onSelectRow={onSelectRow}
      />,
    )

    expect(screen.queryByTestId('percentile-chart-active-marker')).not.toBeInTheDocument()

    await user.click(screen.getByLabelText(/^Age 36:/))

    expect(screen.getByTestId('percentile-chart-active-marker')).toBeInTheDocument()
    expect(onSelectRow).toHaveBeenCalledWith(rows[1])
  })

  it('renders evenly-spaced y-axis gridline labels showing formatted dollar amounts', () => {
    render(<PercentileLineChart rows={rows} series={percentileSeries} title="Monte Carlo outcomes" />)
    const labels = screen.getAllByTestId('percentile-chart-y-axis-label')
    expect(labels.length).toBeGreaterThanOrEqual(3)
    for (const label of labels) {
      expect(label).toHaveTextContent(/^\$[\d,]+$/)
    }
  })

  it('rounds a just-over-$1M y-axis label to the nearest $100k as a full number, not an abbreviation', () => {
    const highRows: LineChartRow[] = [
      { age: 60, year: 0, values: { p10: 900_000, p50: 1_050_000, p90: 1_180_000 } },
    ]
    render(<PercentileLineChart rows={highRows} series={percentileSeries} title="Monte Carlo outcomes" />)
    const labels = screen.getAllByTestId('percentile-chart-y-axis-label')
    // top gridline == maxValue == 1,180,000, rounds to nearest 100k => $1,200,000
    expect(labels[0]).toHaveTextContent('$1,200,000')
  })

  it('abbreviates a comfortably-multi-million y-axis label to one decimal of millions', () => {
    const highRows: LineChartRow[] = [
      { age: 60, year: 0, values: { p10: 3_000_000, p50: 4_500_000, p90: 5_186_787 } },
    ]
    render(<PercentileLineChart rows={highRows} series={percentileSeries} title="Monte Carlo outcomes" />)
    const labels = screen.getAllByTestId('percentile-chart-y-axis-label')
    expect(labels[0]).toHaveTextContent('$5.2M')
  })
})
