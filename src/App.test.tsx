import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

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
})
