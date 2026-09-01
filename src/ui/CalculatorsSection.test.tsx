import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CalculatorsSection } from './CalculatorsSection'

describe('CalculatorsSection', () => {
  afterEach(() => cleanup())

  it('focuses the heading on mount', () => {
    render(<CalculatorsSection />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus()
  })

  it('renders the CalculatorPicker with Investment Calculator selected by default', () => {
    render(<CalculatorsSection />)

    expect(screen.getByRole('button', { name: /investment calculator/i })).toBeInTheDocument()
  })

  it('renders the InvestmentCalculator in place by default', () => {
    render(<CalculatorsSection />)

    expect(screen.getByRole('region', { name: /investment calculator/i })).toBeInTheDocument()
  })

  it('keeps the same calculator selected when reopening and re-picking it (in-place swap, no navigation)', async () => {
    const user = userEvent.setup()
    render(<CalculatorsSection />)

    await user.click(screen.getByRole('button', { name: /investment calculator/i }))
    await user.click(screen.getByRole('option', { name: /investment calculator/i }))

    expect(screen.getByRole('region', { name: /investment calculator/i })).toBeInTheDocument()
    expect(screen.queryByText(/no calculators yet/i)).not.toBeInTheDocument()
  })
})
