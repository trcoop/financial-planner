import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChartContainer } from './ChartContainer'
import type { ChartRow } from './types'

const rows: ChartRow[] = [
  {
    age: 35,
    year: 0,
    beginningBalance: 100_000,
    annualContribution: 15_000,
    investmentReturn: 7_000,
    endingBalance: 122_000,
  },
  {
    age: 36,
    year: 1,
    beginningBalance: 122_000,
    annualContribution: 15_450,
    investmentReturn: 8_540,
    endingBalance: 145_990,
  },
  {
    age: 37,
    year: 2,
    beginningBalance: 145_990,
    annualContribution: 15_914,
    investmentReturn: 10_193,
    endingBalance: 172_097,
  },
]

describe('ChartContainer', () => {
  afterEach(() => cleanup())

  it('renders one bar per row in a titled figure', () => {
    render(<ChartContainer rows={rows} title="Year-by-year balance" />)
    const chart = screen.getByRole('figure', { name: 'Year-by-year balance' })
    expect(chart).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Year \d+, age \d+/ })).toHaveLength(3)
  })

  it('defaults the last year in the data as selected', () => {
    render(<ChartContainer rows={rows} title="Year-by-year balance" />)
    const bars = screen.getAllByRole('button', { name: /^Year \d+, age \d+/ })
    expect(bars[2]).toHaveAttribute('aria-pressed', 'true')
    expect(bars[0]).toHaveAttribute('aria-pressed', 'false')
    expect(bars[1]).toHaveAttribute('aria-pressed', 'false')
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

  it('renders nothing selectable and no crash when given an empty rows array', () => {
    render(<ChartContainer rows={[]} title="Year-by-year balance" />)
    expect(screen.getByRole('figure', { name: 'Year-by-year balance' })).toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
