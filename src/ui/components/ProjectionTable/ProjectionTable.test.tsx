import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProjectionRow } from '../../../engine/types'
import { ProjectionTable } from './ProjectionTable'

function makeRow(overrides: Partial<ProjectionRow> = {}): ProjectionRow {
  return {
    age: 35,
    year: 0,
    beginningBalance: 250000,
    annualContribution: 12750,
    investmentReturn: 17500,
    annualWithdrawal: 0,
    endingBalance: 280250,
    ...overrides,
  }
}

describe('ProjectionTable', () => {
  afterEach(() => cleanup())

  it('renders column headers in the required order', () => {
    render(<ProjectionTable rows={[makeRow()]} />)
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual([
      'Year',
      'Age',
      'Balance Start ($)',
      'Annual Contribution/Withdrawal ($)',
      'Investment Return ($)',
      'Balance End ($)',
    ])
  })

  it('renders one row per ProjectionRow fixture', () => {
    const rows = Array.from({ length: 66 }, (_, i) =>
      makeRow({ age: 35 + i, year: i, beginningBalance: 1000 * i, endingBalance: 1000 * (i + 1) }),
    )
    render(<ProjectionTable rows={rows} />)
    // one header row + 66 data rows
    expect(screen.getAllByRole('row')).toHaveLength(67)
  })

  it('maps year to a 1-indexed Year column and displays age', () => {
    render(<ProjectionTable rows={[makeRow({ year: 0, age: 35 }), makeRow({ year: 1, age: 36 })]} />)
    const rows = screen.getAllByRole('row').slice(1) // drop header row
    const cellsOf = (row: HTMLElement) => within(row).getAllByRole('cell').map((c) => c.textContent)
    expect(cellsOf(rows[0])[0]).toBe('1')
    expect(cellsOf(rows[0])[1]).toBe('35')
    expect(cellsOf(rows[1])[0]).toBe('2')
    expect(cellsOf(rows[1])[1]).toBe('36')
  })

  it('formats currency values with $ and thousands separators', () => {
    render(
      <ProjectionTable
        rows={[
          makeRow({
            beginningBalance: 1234567,
            annualContribution: 12750,
            investmentReturn: 17500,
            annualWithdrawal: 0,
            endingBalance: 1264817,
          }),
        ]}
      />,
    )
    expect(screen.getByText('$1,234,567')).toBeInTheDocument()
    expect(screen.getByText('$12,750')).toBeInTheDocument()
    expect(screen.getByText('$17,500')).toBeInTheDocument()
    expect(screen.getByText('$1,264,817')).toBeInTheDocument()
  })

  it('shows the nonzero of contribution/withdrawal as a plain positive number', () => {
    render(
      <ProjectionTable
        rows={[
          makeRow({ annualContribution: 12750, annualWithdrawal: 0 }),
          makeRow({ year: 1, age: 36, annualContribution: 0, annualWithdrawal: 40000 }),
        ]}
      />,
    )
    expect(screen.getByText('$12,750')).toBeInTheDocument()
    expect(screen.getByText('$40,000')).toBeInTheDocument()
  })

  it('applies a scrollable container with a max height and sticky header styling', () => {
    const { container } = render(<ProjectionTable rows={[makeRow()]} />)
    const scrollContainer = container.firstChild as HTMLElement
    expect(scrollContainer.className).toMatch(/scrollContainer/)
    const thead = container.querySelector('thead')
    expect(thead).not.toBeNull()
    expect(thead?.className).toMatch(/stickyHead/)
  })
})
