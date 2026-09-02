import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { PercentileLineChart, type LineChartRow, type LineChartSeries } from '../PercentileLineChart/PercentileLineChart'
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
    eventCosts: [],
  },
  {
    age: 36,
    year: 1,
    beginningBalance: 122_000,
    annualContribution: 15_450,
    investmentReturn: 8_540,
    annualWithdrawal: 0,
    endingBalance: 145_990,
    eventCosts: [],
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
  eventCosts: [],
}

const medicareRow: ChartRow = {
  age: 65,
  year: 30,
  beginningBalance: 1_100_000,
  annualContribution: 0,
  investmentReturn: 77_000,
  annualWithdrawal: 46_434.8,
  endingBalance: 1_130_565.2,
  eventCosts: [{ id: 'medicarePartB', amount: 2_434.8 }],
}

const preMedicareRow: ChartRow = {
  age: 64,
  year: 29,
  beginningBalance: 1_050_000,
  annualContribution: 0,
  investmentReturn: 73_500,
  annualWithdrawal: 44_000,
  endingBalance: 1_079_500,
  eventCosts: [],
}

const SERIES: LineChartSeries[] = [{ key: 'balance', label: 'Balance', color: 'var(--color-primary)' }]

function ConnectedView({ initialRows }: { initialRows: ChartRow[] }) {
  const [selected, setSelected] = useState<ChartRow | undefined>(initialRows.at(-1))
  const lineRows: LineChartRow[] = initialRows.map((row) => ({
    year: row.year,
    age: row.age,
    values: { balance: row.endingBalance },
  }))
  const handleSelect = (lineRow: LineChartRow) => {
    const row = initialRows.find((r) => r.year === lineRow.year)
    if (row) setSelected(row)
  }
  return (
    <>
      <PercentileLineChart rows={lineRows} series={SERIES} title="Year-by-year balance" onSelectRow={handleSelect} />
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
    expect(panel).toHaveTextContent(/click any point/i)
    expect(panel.querySelector('dl')).not.toBeInTheDocument()
  })

  it('keeps the instructional caption visible alongside the detail rows once a row is selected', () => {
    render(<YearDetailPanel row={rows[0]} />)
    const panel = screen.getByRole('region', { name: 'Year detail' })
    expect(panel).toHaveTextContent(/click any point/i)
    expect(panel.querySelector('dl')).toBeInTheDocument()
  })

  it('updates its content when a time slice in PercentileLineChart is selected', async () => {
    const user = userEvent.setup()
    render(<ConnectedView initialRows={rows} />)

    const panel = screen.getByRole('region', { name: 'Year detail' })
    // Defaults to the last row (year 1 / age 36).
    expect(panel).toHaveTextContent('$145,990')

    const firstTarget = screen.getByLabelText(/^Age 35:/)
    await user.click(firstTarget)

    expect(panel).toHaveTextContent('$122,000')
    expect(panel).not.toHaveTextContent('$145,990')
  })

  it('shows a non-zero Medicare line for a year with a medicarePartB eventCosts entry (FIN-73)', () => {
    render(<YearDetailPanel row={medicareRow} />)
    const panel = screen.getByRole('region', { name: 'Year detail' })
    expect(panel).toHaveTextContent('Medicare')
    expect(panel).toHaveTextContent('$2,435')
  })

  it('shows no Medicare line for a year with an empty eventCosts array (FIN-73)', () => {
    render(<YearDetailPanel row={preMedicareRow} />)
    const panel = screen.getByRole('region', { name: 'Year detail' })
    expect(panel).not.toHaveTextContent('Medicare')
  })

  it('sums the primary and spouse Medicare entries into one Medicare line (FIN-121)', () => {
    const bothMedicareRow: ChartRow = {
      ...medicareRow,
      eventCosts: [
        { id: 'medicarePartB', amount: 2_434.8 },
        { id: 'medicareSpousePartB', amount: 2_434.8 },
      ],
    }
    render(<YearDetailPanel row={bothMedicareRow} />)
    const panel = screen.getByRole('region', { name: 'Year detail' })
    expect(panel).toHaveTextContent('Medicare')
    expect(panel).toHaveTextContent('$4,870')
  })
})
