import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App'

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
    expect(screen.getAllByRole('row')).toHaveLength(66 + 1) // + header row
    expect(screen.getByRole('cell', { name: '35' })).toBeInTheDocument()
  })

  it('recalculates the table when a core input changes', () => {
    render(<App />)
    const age = screen.getByLabelText('Current age')
    fireEvent.change(age, { target: { value: '60' } })

    // 60 through 100 inclusive = 41 rows
    expect(screen.getAllByRole('row')).toHaveLength(41 + 1)
    expect(screen.queryByRole('cell', { name: '35' })).not.toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '60' })).toBeInTheDocument()
  })
})
