import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChartContainer } from './ChartContainer'
import type { ChartRow } from './types'

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

  describe('retirement marker (FIN-42)', () => {
    it('renders no retirement marker when retirementAge is absent (regression guard)', () => {
      render(<ChartContainer rows={rows} title="Year-by-year balance" />)
      expect(screen.queryByTestId('chart-retirement-marker')).not.toBeInTheDocument()
      // Bar count/labels/structure exactly as today.
      expect(screen.getAllByRole('button', { name: /^Year \d+, age \d+/ })).toHaveLength(3)
    })

    it('renders a retirement marker at the bar matching retirementAge', () => {
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

    it('still fires onSelectRow for a bar click when the retirement marker is present (actual non-interception is enforced by pointer-events: none, asserted separately below)', async () => {
      const user = userEvent.setup()
      const onSelectRow = vi.fn()
      render(
        <ChartContainer rows={rows} title="Year-by-year balance" retirementAge={36} onSelectRow={onSelectRow} />,
      )
      const bars = screen.getAllByRole('button', { name: /^Year \d+, age \d+/ })
      await user.click(bars[0])
      expect(onSelectRow).toHaveBeenCalledWith(rows[0])
    })

    it('marker overlay element is non-interactive (pointer-events: none)', () => {
      render(<ChartContainer rows={rows} title="Year-by-year balance" retirementAge={36} />)
      const marker = screen.getByTestId('chart-retirement-marker')
      expect(marker.style.pointerEvents).toBe('none')
    })
  })
})
