import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { ChartContainer } from '../ChartContainer/ChartContainer'
import type { ChartRow } from '../ChartContainer/types'
import { YearDetailPanel } from './YearDetailPanel'

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
]

const retirementRow: ChartRow = {
  age: 67,
  year: 32,
  beginningBalance: 1_200_000,
  annualContribution: 0,
  investmentReturn: 84_000,
  annualWithdrawal: 48_000,
  endingBalance: 1_236_000,
}

function ConnectedView({ initialRows }: { initialRows: ChartRow[] }) {
  const [selected, setSelected] = useState<ChartRow | undefined>(initialRows.at(-1))
  return (
    <>
      <ChartContainer rows={initialRows} title="Year-by-year balance" onSelectRow={setSelected} />
      <YearDetailPanel row={selected} />
    </>
  )
}

describe('YearDetailPanel', () => {
  afterEach(() => cleanup())

  it('shows a headline with age and year, the ending balance, and the remaining detail rows', () => {
    render(<YearDetailPanel row={rows[0]} />)
    const panel = screen.getByRole('region', { name: 'Year detail' })
    expect(panel).toHaveTextContent('Age 35 · Year 1')
    expect(panel).toHaveTextContent('$100,000')
    expect(panel).toHaveTextContent('$15,000')
    expect(panel).toHaveTextContent('$7,000')
    expect(panel).toHaveTextContent('$122,000')
  })

  it('does not render Year or Age as separate dl rows now that they are in the headline', () => {
    render(<YearDetailPanel row={rows[0]} />)
    const panel = screen.getByRole('region', { name: 'Year detail' })
    for (const dt of panel.querySelectorAll('dt')) {
      expect(dt.textContent).not.toBe('Year')
      expect(dt.textContent).not.toBe('Age')
    }
  })

  it('shows the annual withdrawal for a retirement-year row', () => {
    render(<YearDetailPanel row={retirementRow} />)
    const panel = screen.getByRole('region', { name: 'Year detail' })
    expect(panel).toHaveTextContent('Annual withdrawal')
    expect(panel).toHaveTextContent('$48,000')
  })

  it('renders only the instructional caption when no row is selected', () => {
    render(<YearDetailPanel row={undefined} />)
    const panel = screen.getByRole('region', { name: 'Year detail' })
    expect(panel).toHaveTextContent(/click any bar/i)
    expect(panel.querySelector('dl')).not.toBeInTheDocument()
  })

  it('keeps the instructional caption visible alongside the detail rows once a row is selected', () => {
    render(<YearDetailPanel row={rows[0]} />)
    const panel = screen.getByRole('region', { name: 'Year detail' })
    expect(panel).toHaveTextContent(/click any bar/i)
    expect(panel.querySelector('dl')).toBeInTheDocument()
  })

  it("updates its content when a bar in ChartContainer is selected", async () => {
    const user = userEvent.setup()
    render(<ConnectedView initialRows={rows} />)

    const panel = screen.getByRole('region', { name: 'Year detail' })
    // Defaults to the last row (year 1 / age 36).
    expect(panel).toHaveTextContent('$145,990')

    const firstBar = screen.getByRole('button', { name: 'Year 1, age 35' })
    await user.click(firstBar)

    expect(panel).toHaveTextContent('$122,000')
    expect(panel).not.toHaveTextContent('$145,990')
  })
})
