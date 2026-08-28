import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PercentileLineChart, type LineChartRow, type LineChartSeries } from './PercentileLineChart'

/** jsdom has no `TouchEvent` constructor and no real layout engine, so touch gestures are
 * simulated as plain `Event`s carrying a `touches`/`changedTouches` array (the only properties
 * the component's native listeners read), dispatched against a wrapper whose
 * `getBoundingClientRect` is stubbed to a fixed, non-zero box — real jsdom rects are always
 * zero-sized, which would make every touch resolve to index 0. Wrapped in `act` because these
 * are native `addEventListener` handlers, not React synthetic events, so React doesn't flush
 * the resulting state update automatically the way it would for a `fireEvent` call. */
const dispatchTouch = (target: Element, type: string, clientX: number) => {
  let event!: Event
  act(() => {
    event = new Event(type, { bubbles: true, cancelable: true })
    const touch = { clientX, clientY: 0 }
    Object.defineProperty(event, 'touches', { value: [touch] })
    Object.defineProperty(event, 'changedTouches', { value: [touch] })
    target.dispatchEvent(event)
  })
  return event
}

/** The plot wrapper (the touch listeners' attach target) has no test id of its own — it's the
 * `<svg>`'s parent, which is stable regardless of the wrapper's hashed CSS Module class name. */
const getPlotWrapper = (container: HTMLElement): HTMLElement => {
  const svg = container.querySelector('svg')
  if (!svg?.parentElement) throw new Error('plot wrapper not found')
  svg.parentElement.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 300, bottom: 100, width: 300, height: 100, x: 0, y: 0, toJSON: () => {} }) as DOMRect
  return svg.parentElement
}

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

  it('renders a permanent Medicare-start marker with the exact tooltip text when medicareStartAge matches a row (FIN-73)', () => {
    render(
      <PercentileLineChart rows={rows} series={percentileSeries} title="Monte Carlo outcomes" medicareStartAge={36} />,
    )
    const markers = screen.getAllByTestId('percentile-chart-medicare-marker')
    expect(markers).toHaveLength(1)
    expect(markers[0]).toHaveAttribute('title', 'Medicare starts.')
  })

  it('renders no Medicare marker when medicareStartAge is omitted or matches no row', () => {
    const { rerender } = render(
      <PercentileLineChart rows={rows} series={percentileSeries} title="Monte Carlo outcomes" />,
    )
    expect(screen.queryByTestId('percentile-chart-medicare-marker')).not.toBeInTheDocument()

    rerender(
      <PercentileLineChart rows={rows} series={percentileSeries} title="Monte Carlo outcomes" medicareStartAge={99} />,
    )
    expect(screen.queryByTestId('percentile-chart-medicare-marker')).not.toBeInTheDocument()
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

  it('suppresses the active-period marker when showActiveMarker is false, while still tracking selection', async () => {
    const user = userEvent.setup()
    const onSelectRow = vi.fn()
    render(
      <PercentileLineChart
        rows={rows}
        series={percentileSeries}
        title="Monte Carlo outcomes"
        defaultSelectedYear={1}
        onSelectRow={onSelectRow}
        showActiveMarker={false}
      />,
    )

    expect(screen.queryByTestId('percentile-chart-active-marker')).not.toBeInTheDocument()

    await user.click(screen.getByLabelText(/^Age 37:/))

    expect(screen.queryByTestId('percentile-chart-active-marker')).not.toBeInTheDocument()
    expect(onSelectRow).toHaveBeenCalledWith(rows[2])
  })

  it("shapes a non-last series' area polygon bottom edge to follow the next series' line, not a constant chart-bottom value", () => {
    const { container } = render(
      <PercentileLineChart rows={rows} series={percentileSeries} title="Monte Carlo outcomes" />,
    )
    // First polygon is the p90 area (series[0]); its bottom edge should follow p50 (series[1]),
    // per FIN-60's "shading beneath each line, down to the next line". Data maxValue across all
    // rows is 260,000 (p90's last row); the chart plots with 15% headroom above that (FIN-73 —
    // see `CHART_HEADROOM_FACTOR`), and VIEW_HEIGHT is 200 — so if the bottom edge used a
    // constant chart-bottom value instead (the mutation under test), every bottom y would be
    // exactly 200 regardless of p50's actual values.
    const p90Area = container.querySelectorAll('polygon')[0]
    const points = p90Area.getAttribute('points')?.trim().split(/\s+/) ?? []
    expect(points).toHaveLength(rows.length * 2)

    // Bottom half is the second half of the points list, in reverse row order (row2, row1, row0).
    const bottomPoints = points.slice(rows.length)
    const bottomYs = bottomPoints.map((p) => Number(p.split(',')[1]))

    const maxValue = 260_000 * 1.15
    const expectedYs = [...rows]
      .reverse()
      .map((row) => 200 - (row.values.p50 / maxValue) * 200)

    bottomYs.forEach((y, i) => expect(y).toBeCloseTo(expectedYs[i], 3))
    // None of these should be the constant chart-bottom value (VIEW_HEIGHT = 200) — confirming
    // the bottom edge genuinely tracks the next series rather than always sitting at the floor.
    for (const y of bottomYs) {
      expect(y).not.toBeCloseTo(200, 3)
    }
    // And the bottom edge must actually vary across rows (not just "not 200" but genuinely
    // following p50's changing values row to row).
    expect(new Set(bottomYs.map((y) => y.toFixed(3))).size).toBe(rows.length)
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
    // top gridline == maxValue * 1.15 headroom (FIN-73) == 1,357,000, rounds to nearest 100k =>
    // $1,400,000
    expect(labels[0]).toHaveTextContent('$1,400,000')
  })

  it('abbreviates a comfortably-multi-million y-axis label to one decimal of millions', () => {
    const highRows: LineChartRow[] = [
      { age: 60, year: 0, values: { p10: 3_000_000, p50: 4_500_000, p90: 5_186_787 } },
    ]
    render(<PercentileLineChart rows={highRows} series={percentileSeries} title="Monte Carlo outcomes" />)
    const labels = screen.getAllByTestId('percentile-chart-y-axis-label')
    // maxValue * 1.15 headroom (FIN-73) == 5,964,805.05, abbreviates to $6.0M
    expect(labels[0]).toHaveTextContent('$6.0M')
  })

  it('renders a year-scrubber slider spanning the rows, wired to the same selection as a click (FIN-61)', () => {
    const onSelectRow = vi.fn()
    render(
      <PercentileLineChart
        rows={rows}
        series={percentileSeries}
        title="Monte Carlo outcomes"
        onSelectRow={onSelectRow}
      />,
    )

    const slider = screen.getByLabelText('Select a year on Monte Carlo outcomes')
    expect(slider).toHaveAttribute('min', '0')
    expect(slider).toHaveAttribute('max', String(rows.length - 1))

    fireEvent.change(slider, { target: { value: '2' } })

    expect(onSelectRow).toHaveBeenCalledWith(rows[2])
    expect(screen.getByTestId('percentile-chart-active-marker')).toBeInTheDocument()
  })

  it('a drag shows a live tooltip that follows the touch and selects the point it ends on (FIN-61)', () => {
    const onSelectRow = vi.fn()
    const { container } = render(
      <PercentileLineChart rows={rows} series={percentileSeries} title="Monte Carlo outcomes" onSelectRow={onSelectRow} />,
    )
    const wrapper = getPlotWrapper(container)

    dispatchTouch(wrapper, 'touchstart', 0)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    dispatchTouch(wrapper, 'touchmove', 150) // middle of the 300px-wide stub rect -> index 1
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Age 36')

    // touchend fires at a *different* x (back near the start) than the last touchmove — a real
    // finger lift is never pixel-exact to where the last move landed. Selection must use the
    // last dragged position (index 1), not recompute from touchend's own x (which would give
    // index 0), pinning the `dragged` branch against silently always recomputing from touchend.
    dispatchTouch(wrapper, 'touchend', 0)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(onSelectRow).toHaveBeenCalledWith(rows[1])
  })

  it('touchmove calls preventDefault so a drag moves the tooltip instead of scrolling the page (FIN-61)', () => {
    const { container } = render(<PercentileLineChart rows={rows} series={percentileSeries} title="Monte Carlo outcomes" />)
    const wrapper = getPlotWrapper(container)

    dispatchTouch(wrapper, 'touchstart', 0)
    const moveEvent = dispatchTouch(wrapper, 'touchmove', 150)

    expect(moveEvent.defaultPrevented).toBe(true)
  })

  it('a plain tap (no touchmove) selects the tapped point without ever showing a tooltip (FIN-61)', () => {
    const onSelectRow = vi.fn()
    const { container } = render(
      <PercentileLineChart rows={rows} series={percentileSeries} title="Monte Carlo outcomes" onSelectRow={onSelectRow} />,
    )
    const wrapper = getPlotWrapper(container)

    dispatchTouch(wrapper, 'touchstart', 300) // rightmost -> index 2 (last row)
    dispatchTouch(wrapper, 'touchend', 300)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(onSelectRow).toHaveBeenCalledWith(rows[2])
  })
})
