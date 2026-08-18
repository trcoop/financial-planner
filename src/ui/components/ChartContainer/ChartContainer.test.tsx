import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChartContainer } from './ChartContainer'
import type { ChartBandRow, ChartRow } from './types'

/**
 * jsdom's `getBoundingClientRect` always returns all-zero rects, which would make every bar
 * measure to the same {left: 0, width: 0} and defeat the point of testing the
 * measure-the-real-DOM mechanism (ERD §6.4). This stub gives each bar button a distinct,
 * deterministic rect based on its position among its siblings, and the plot container a fixed
 * origin/width, so the band/marker positioning math has real (if synthetic) geometry to work
 * with — the same approach a real browser layout would produce, just precomputed.
 */
function stubBarLayout() {
  const BAR_WIDTH = 20
  const GAP = 4
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const isBar = this.tagName === 'BUTTON'
    if (isBar) {
      // Only count sibling <button>s (the band/marker overlay divs are `position: absolute`
      // in the real CSS module and taken out of flow, so they don't affect bar position in a
      // real browser — jsdom doesn't apply stylesheet rules, so this stub mirrors that
      // out-of-flow behavior explicitly instead of counting every DOM sibling).
      const siblings = Array.from(this.parentElement?.children ?? []).filter((el) => el.tagName === 'BUTTON')
      const index = siblings.indexOf(this)
      return {
        left: index * (BAR_WIDTH + GAP),
        right: index * (BAR_WIDTH + GAP) + BAR_WIDTH,
        width: BAR_WIDTH,
        top: 0,
        bottom: 100,
        height: 100,
        x: index * (BAR_WIDTH + GAP),
        y: 0,
        toJSON() {},
      }
    }
    // The .plot container itself (or anything else measured) sits at the origin.
    return {
      left: 0,
      right: 1000,
      width: 1000,
      top: 0,
      bottom: 100,
      height: 100,
      x: 0,
      y: 0,
      toJSON() {},
    }
  })
}

const rows: ChartRow[] = [
  {
    age: 35,
    year: 0,
    beginningBalance: 100_000,
    annualContribution: 15_000,
    investmentReturn: 7_000,
    annualWithdrawal: 0,
    endingBalance: 122_000,
  },
  {
    age: 36,
    year: 1,
    beginningBalance: 122_000,
    annualContribution: 15_450,
    investmentReturn: 8_540,
    annualWithdrawal: 0,
    endingBalance: 145_990,
  },
  {
    age: 37,
    year: 2,
    beginningBalance: 145_990,
    annualContribution: 15_914,
    investmentReturn: 10_193,
    annualWithdrawal: 0,
    endingBalance: 172_097,
  },
]

describe('ChartContainer', () => {
  beforeEach(() => stubBarLayout())
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders one bar per row in a titled figure', () => {
    render(<ChartContainer rows={rows} title="Year-by-year balance" />)
    const chart = screen.getByRole('figure', { name: 'Year-by-year balance' })
    expect(chart).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Year \d+, age \d+/ })).toHaveLength(3)
  })

  it('labels the first bar and the last bar (sparse labeling for long horizons)', () => {
    render(<ChartContainer rows={rows} title="Year-by-year balance" />)
    expect(screen.getByText('35')).toBeInTheDocument()
    expect(screen.getByText('37')).toBeInTheDocument()
  })

  it('labels only every 5th bar plus the last bar on a long horizon', () => {
    const longRows: ChartRow[] = Array.from({ length: 12 }, (_, i) => ({
      age: 35 + i,
      year: i,
      beginningBalance: 100_000,
      annualContribution: 15_000,
      investmentReturn: 7_000,
      annualWithdrawal: 0,
      endingBalance: 122_000 + i * 1_000,
    }))
    render(<ChartContainer rows={longRows} title="Year-by-year balance" />)
    // Labeled: index 0, 5, 10 (every 5th) plus index 11 (last) -> ages 35, 40, 45, 46.
    for (const age of [35, 40, 45, 46]) {
      expect(screen.getByText(String(age))).toBeInTheDocument()
    }
    // Not labeled: e.g. age 36 (index 1).
    expect(screen.queryByText('36')).not.toBeInTheDocument()
  })

  it('renders a range subtitle spanning the first and last row ages', () => {
    render(<ChartContainer rows={rows} title="Year-by-year balance" />)
    expect(screen.getByText('Age 35 → 37')).toBeInTheDocument()
  })

  it('renders a single-year range subtitle when there is only one row', () => {
    render(<ChartContainer rows={[rows[0]]} title="Year-by-year balance" />)
    expect(screen.getByText('Age 35 → 35')).toBeInTheDocument()
  })

  it('renders no range subtitle and no age labels when rows is empty', () => {
    render(<ChartContainer rows={[]} title="Year-by-year balance" />)
    expect(screen.queryByText(/^Age /)).not.toBeInTheDocument()
  })

  it('defaults the last year in the data as selected', () => {
    render(<ChartContainer rows={rows} title="Year-by-year balance" />)
    const bars = screen.getAllByRole('button', { name: /^Year \d+, age \d+/ })
    expect(bars[2]).toHaveAttribute('aria-pressed', 'true')
    expect(bars[0]).toHaveAttribute('aria-pressed', 'false')
    expect(bars[1]).toHaveAttribute('aria-pressed', 'false')
  })

  it('selects the row matching defaultSelectedYear instead of the last row, when provided', () => {
    render(<ChartContainer rows={rows} title="Year-by-year balance" defaultSelectedYear={1} />)
    const bars = screen.getAllByRole('button', { name: /^Year \d+, age \d+/ })
    expect(bars[1]).toHaveAttribute('aria-pressed', 'true')
    expect(bars[0]).toHaveAttribute('aria-pressed', 'false')
    expect(bars[2]).toHaveAttribute('aria-pressed', 'false')
  })

  it('falls back to the last row when defaultSelectedYear matches no row', () => {
    render(<ChartContainer rows={rows} title="Year-by-year balance" defaultSelectedYear={999} />)
    const bars = screen.getAllByRole('button', { name: /^Year \d+, age \d+/ })
    expect(bars[2]).toHaveAttribute('aria-pressed', 'true')
  })

  it('selects a bar on click, marking it pressed and calling onSelectRow with that row', async () => {
    const user = userEvent.setup()
    const onSelectRow = vi.fn()
    render(<ChartContainer rows={rows} title="Year-by-year balance" onSelectRow={onSelectRow} />)

    const bars = screen.getAllByRole('button', { name: /^Year \d+, age \d+/ })
    await user.click(bars[0])

    expect(bars[0]).toHaveAttribute('aria-pressed', 'true')
    expect(bars[2]).toHaveAttribute('aria-pressed', 'false')
    expect(onSelectRow).toHaveBeenCalledWith(rows[0])
  })

  it('does not overflow the viewport at mobile widths', () => {
    render(<ChartContainer rows={rows} title="Year-by-year balance" />)
    const chart = screen.getByRole('figure', { name: 'Year-by-year balance' })
    expect(chart).toHaveStyle({ width: '100%', maxWidth: '100%', boxSizing: 'border-box' })
  })

  it('scrolls the initially-selected (last) bar into view on mount', () => {
    const scrollIntoView = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoView

    render(<ChartContainer rows={rows} title="Year-by-year balance" />)

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'center' })
  })

  it('renders nothing selectable and no crash when given an empty rows array', () => {
    render(<ChartContainer rows={[]} title="Year-by-year balance" />)
    expect(screen.getByRole('figure', { name: 'Year-by-year balance' })).toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  describe('Monte Carlo band (FIN-42)', () => {
    const band: ChartBandRow[] = [
      { year: 0, p10: 80_000, p90: 160_000 },
      { year: 1, p10: 90_000, p90: 200_000 },
      { year: 2, p10: 100_000, p90: 260_000 },
    ]

    it('renders no band elements and no retirement marker when band/retirementAge are absent (regression guard)', () => {
      render(<ChartContainer rows={rows} title="Year-by-year balance" />)
      expect(screen.queryByTestId(/^chart-band-/)).not.toBeInTheDocument()
      expect(screen.queryAllByTestId(/^chart-band-/)).toHaveLength(0)
      expect(screen.queryByTestId('chart-retirement-marker')).not.toBeInTheDocument()
      // Bar count/labels/structure exactly as today.
      expect(screen.getAllByRole('button', { name: /^Year \d+, age \d+/ })).toHaveLength(3)
    })

    it('renders one band element per band row, behind the bars in DOM order', () => {
      const { container } = render(<ChartContainer rows={rows} title="Year-by-year balance" band={band} />)
      const bandEls = screen.getAllByTestId(/^chart-band-/)
      expect(bandEls).toHaveLength(3)

      const plot = container.querySelector('[class*="plot"]')
      expect(plot).not.toBeNull()
      const children = Array.from(plot?.children ?? [])
      const lastBandIndex = Math.max(...bandEls.map((el) => children.indexOf(el)))
      const firstBarIndex = children.findIndex((el) => el.tagName === 'BUTTON')
      expect(lastBandIndex).toBeLessThan(firstBarIndex)
    })

    it('sizes each band element so p10/p90 heights order correctly relative to the bar (band spans below and above a mid-range bar)', () => {
      render(<ChartContainer rows={rows} title="Year-by-year balance" band={band} />)
      const bandEls = screen.getAllByTestId(/^chart-band-/)
      const bars = screen.getAllByRole('button', { name: /^Year \d+, age \d+/ })

      // Year 0: endingBalance 122_000, band 80_000-160_000 (maxBalance 260_000 once the band's
      // widest p90 is folded in) -> p10/p90 as percentages of that shared scale.
      const maxBalance = 260_000
      const expectedBottom = (80_000 / maxBalance) * 100
      const expectedHeight = ((160_000 - 80_000) / maxBalance) * 100
      const bottom0 = Number.parseFloat(bandEls[0].style.bottom)
      const height0 = Number.parseFloat(bandEls[0].style.height)
      expect(bottom0).toBeCloseTo(expectedBottom, 5)
      expect(height0).toBeCloseTo(expectedHeight, 5)

      // The band brackets the bar's own height on the same shared scale: p10 <= bar <= p90.
      const barHeight0 = Number.parseFloat(bars[0].style.height)
      expect(bottom0).toBeLessThanOrEqual(barHeight0)
      expect(bottom0 + height0).toBeGreaterThanOrEqual(barHeight0)
    })

    it('extends the height scale so a wide band p90 does not clip (bars shrink relative to their own value)', () => {
      const { rerender } = render(<ChartContainer rows={rows} title="Year-by-year balance" />)
      const barsWithoutBand = screen.getAllByRole('button', { name: /^Year \d+, age \d+/ })
      const lastBarHeightWithoutBand = Number.parseFloat(barsWithoutBand[2].style.height)

      cleanup()
      stubBarLayout()
      render(<ChartContainer rows={rows} title="Year-by-year balance" band={band} />)
      const barsWithBand = screen.getAllByRole('button', { name: /^Year \d+, age \d+/ })
      const lastBarHeightWithBand = Number.parseFloat(barsWithBand[2].style.height)

      // band's max p90 (260_000) exceeds the max endingBalance (172_097), so the scale widens
      // and the same bar's height percentage shrinks.
      expect(lastBarHeightWithBand).toBeLessThan(lastBarHeightWithoutBand)
      void rerender
    })

    it('positions each band element at the same left/width as its matching bar', () => {
      render(<ChartContainer rows={rows} title="Year-by-year balance" band={band} />)
      const bars = screen.getAllByRole('button', { name: /^Year \d+, age \d+/ })
      const bandEls = screen.getAllByTestId(/^chart-band-/)

      for (let i = 0; i < rows.length; i++) {
        expect(bandEls[i].style.left).toBe(bars[i].getBoundingClientRect().left + 'px')
        expect(bandEls[i].style.width).toBe(bars[i].getBoundingClientRect().width + 'px')
      }
    })

    it('renders a retirement marker at the bar matching retirementAge, independent of band', () => {
      render(<ChartContainer rows={rows} title="Year-by-year balance" retirementAge={36} />)
      const marker = screen.getByTestId('chart-retirement-marker')
      expect(marker).toBeInTheDocument()

      const bars = screen.getAllByRole('button', { name: /^Year \d+, age \d+/ })
      // age 36 is row index 1.
      expect(marker.style.left).toBe(bars[1].getBoundingClientRect().left + 'px')
    })

    it('renders no retirement marker when retirementAge matches no row', () => {
      render(<ChartContainer rows={rows} title="Year-by-year balance" retirementAge={99} />)
      expect(screen.queryByTestId('chart-retirement-marker')).not.toBeInTheDocument()
    })

    it('still fires onSelectRow for a bar click when band and retirement marker are both present (actual non-interception is enforced by pointer-events: none, asserted separately below)', async () => {
      const user = userEvent.setup()
      const onSelectRow = vi.fn()
      render(
        <ChartContainer
          rows={rows}
          title="Year-by-year balance"
          band={band}
          retirementAge={36}
          onSelectRow={onSelectRow}
        />,
      )
      const bars = screen.getAllByRole('button', { name: /^Year \d+, age \d+/ })
      await user.click(bars[0])
      expect(onSelectRow).toHaveBeenCalledWith(rows[0])
    })

    it('band and marker overlay elements are non-interactive (pointer-events: none)', () => {
      render(<ChartContainer rows={rows} title="Year-by-year balance" band={band} retirementAge={36} />)
      const bandEls = screen.getAllByTestId(/^chart-band-/)
      const marker = screen.getByTestId('chart-retirement-marker')
      for (const el of bandEls) {
        expect(el.style.pointerEvents).toBe('none')
      }
      expect(marker.style.pointerEvents).toBe('none')
    })
  })
})
