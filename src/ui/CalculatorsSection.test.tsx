import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CalculatorsSection, type CalculatorEntry } from './CalculatorsSection'

const stubCalculators: CalculatorEntry[] = [
  {
    id: 'investment',
    label: 'Investment Calculator',
    component: () => <section aria-label="Investment Calculator" />,
  },
  {
    id: 'second',
    label: 'Second Calculator',
    component: () => <section aria-label="Second Calculator" />,
  },
]

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

  it('defaults to the first calculator in the list', () => {
    render(<CalculatorsSection calculators={stubCalculators} />)

    expect(screen.getByRole('region', { name: /investment calculator/i })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /second calculator/i })).not.toBeInTheDocument()
  })

  it('initializes selectedId state to the first calculator\'s id (not a value that only looks right via the find-fallback)', () => {
    render(<CalculatorsSection calculators={stubCalculators} />)

    // Asserts the raw `selectedId` state directly, rather than only the rendered calculator —
    // the `?? calculators[0]` fallback in the render logic means an invalid initial id (e.g. a
    // stray literal) would *still* render the first calculator, masking the bug from a
    // render-only assertion. This is why it needs its own test distinct from the "defaults to
    // the first calculator" test above.
    expect(screen.getByTestId('calculators-section')).toHaveAttribute('data-selected-id', 'investment')
  })

  it('swaps to the newly-picked calculator, unmounting the previous one', async () => {
    const user = userEvent.setup()
    render(<CalculatorsSection calculators={stubCalculators} />)

    await user.click(screen.getByRole('button', { name: /investment calculator/i }))
    await user.click(screen.getByRole('option', { name: /second calculator/i }))

    expect(screen.getByRole('region', { name: /second calculator/i })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /investment calculator/i })).not.toBeInTheDocument()
  })
})
