import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { runProjection } from './engine'

// jsdom has no real Worker; App's StressTestSection creates a real orchestrator by default,
// which would throw on mount. These tests exercise the projection table, not the stress
// test, so a minimal orchestrator double is enough to let the tree render.
vi.mock('./workers', () => ({
  createMonteCarloOrchestrator: () => ({
    getState: () => ({ status: 'idle' }),
    subscribe: () => () => {},
    run: () => new Promise(() => {}),
    cancel: () => {},
  }),
}))

describe('App', () => {
  afterEach(() => cleanup())

  it('renders the core inputs form pre-filled with defaults', () => {
    render(<App />)
    expect(screen.getByLabelText('Current age')).toHaveValue(35)
    expect(screen.getByLabelText('Retirement age')).toHaveValue(67)
    expect(screen.getByLabelText('Current investment balance')).toHaveValue(250000)
    expect(screen.getByLabelText('Current annual income')).toHaveValue(85000)
    expect(screen.getByLabelText('Annual savings percentage')).toHaveValue(15)
  })

  it('populates the projection table immediately on first load, one row per age through 100', () => {
    render(<App />)
    // 35 through 100 inclusive = 66 rows
    const rows = screen.getAllByRole('row')
    expect(rows).toHaveLength(66 + 1) // + header row
    // Age is the 2nd column; the Year column can coincidentally contain the same digits
    // as an Age value elsewhere in the table, so scope the check to the first data row.
    expect(within(rows[1]).getAllByRole('cell')[1]).toHaveTextContent('35')
  })

  it('recalculates the table when a core input changes, debounced ~300ms', async () => {
    render(<App />)
    const age = screen.getByLabelText('Current age')
    fireEvent.change(age, { target: { value: '60' } })

    // Immediately after the change, recalculation must not have fired yet — it's debounced.
    expect(within(screen.getAllByRole('row')[1]).getAllByRole('cell')[1]).toHaveTextContent('35')

    // 60 through 100 inclusive = 41 rows
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(41 + 1))
    const firstDataRow = screen.getAllByRole('row')[1]
    expect(within(firstDataRow).getAllByRole('cell')[1]).toHaveTextContent('60')
  })

  it('pauses recalculation while a core field is out of range, keeping the last valid table', async () => {
    render(<App />)
    const beforeCells = screen.getAllByRole('cell').map((c) => c.textContent)

    const income = screen.getByLabelText('Current annual income')
    fireEvent.change(income, { target: { value: '9000000' } })

    expect(screen.getByRole('alert')).toBeInTheDocument()
    // Give the debounce window time to elapse; the table must still not have moved.
    await new Promise((resolve) => setTimeout(resolve, 350))
    const afterCells = screen.getAllByRole('cell').map((c) => c.textContent)
    expect(afterCells).toEqual(beforeCells)
  })

  it('resumes recalculation once the out-of-range field is corrected', async () => {
    render(<App />)
    const income = screen.getByLabelText('Current annual income')
    fireEvent.change(income, { target: { value: '9000000' } })
    fireEvent.change(income, { target: { value: '200000' } })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Current annual income')).toHaveValue(200000)

    await waitFor(() => {
      expect(screen.getAllByRole('row')).toHaveLength(66 + 1)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  it('renders the advanced assumptions section, collapsed, with FIN-10 defaults', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(screen.getByText('⋯ Advanced assumptions')).toBeInTheDocument()
    const details = screen.getByText('⋯ Advanced assumptions').closest('details')
    expect(details).not.toHaveAttribute('open')

    await user.click(screen.getByText('⋯ Advanced assumptions'))
    expect(screen.getByLabelText('Expected annual raise')).toHaveValue(3)
    expect(screen.getByLabelText('Investment return assumption')).toHaveValue(7)
    expect(screen.getByLabelText('Inflation rate')).toHaveValue(2.5)
    expect(screen.getByLabelText('Withdrawal rate in retirement')).toHaveValue(4)
  })

  it('recalculates the table when an advanced input changes, debounced ~300ms', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByText('⋯ Advanced assumptions'))

    const beforeCells = screen.getAllByRole('cell').map((c) => c.textContent)

    const returnField = screen.getByLabelText('Investment return assumption')
    fireEvent.change(returnField, { target: { value: '2' } })

    // Immediately after the change, recalculation must not have fired yet — it's debounced.
    expect(screen.getAllByRole('cell').map((c) => c.textContent)).toEqual(beforeCells)

    await waitFor(() => {
      expect(screen.getAllByRole('cell').map((c) => c.textContent)).not.toEqual(beforeCells)
    })
  })

  it('converts the advanced assumption percentages to fractions correctly (FIN-10 defaults)', () => {
    render(<App />)

    // Cross-check the rendered first-row "Investment Return ($)" cell against the engine
    // computed directly with FIN-10's default assumptions (3% raise, 7% return, 2.5%
    // inflation, 4% withdrawal, expressed as fractions) — this pins the App-level
    // percent-to-fraction conversion so a regression like forgetting `/ 100` fails loudly
    // instead of merely producing a differently-shaped, still-plausible-looking table.
    const expectedRows = runProjection({
      currentAge: 35,
      retirementAge: 67,
      initialBalance: 250000,
      currentAnnualIncome: 85000,
      annualContributionRate: 0.15,
      planningHorizonEndAge: 100,
      annualRaiseRate: 0.03,
      annualReturnRate: 0.07,
      inflationRate: 0.025,
      withdrawalRateInRetirement: 0.04,
    })

    const firstDataRow = screen.getAllByRole('row')[1]
    const cells = within(firstDataRow).getAllByRole('cell')
    // Investment Return ($) is the 5th column (Year, Age, Balance Start, Contribution, Return, Balance End).
    const expectedReturn = Math.round(expectedRows[0].investmentReturn).toLocaleString('en-US')
    expect(cells[4]).toHaveTextContent(`$${expectedReturn}`)
  })

  it('pauses recalculation while an advanced field is out of range, keeping the last valid table', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByText('⋯ Advanced assumptions'))
    const beforeCells = screen.getAllByRole('cell').map((c) => c.textContent)

    const returnField = screen.getByLabelText('Investment return assumption')
    fireEvent.change(returnField, { target: { value: '-60' } })

    expect(screen.getByRole('alert')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(screen.getAllByRole('cell').map((c) => c.textContent)).toEqual(beforeCells)
  })
})
