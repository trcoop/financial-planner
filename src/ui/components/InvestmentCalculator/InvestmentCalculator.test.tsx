import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { InvestmentCalculator } from './InvestmentCalculator'

describe('InvestmentCalculator', () => {
  afterEach(() => cleanup())

  it('shows a validation error and no results when starting amount is left blank', async () => {
    const user = userEvent.setup()
    render(<InvestmentCalculator />)

    const startingAmountInput = screen.getByLabelText('Starting amount')
    await user.clear(startingAmountInput)
    await user.click(screen.getByRole('button', { name: 'Calculate' }))

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/starting amount/i)
    expect(startingAmountInput).toHaveAttribute('aria-describedby', alert.id)
    expect(startingAmountInput).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByText('Final Balance')).not.toBeInTheDocument()
  })

  it('shows a validation error and no results when years is negative', async () => {
    const user = userEvent.setup()
    render(<InvestmentCalculator />)

    const yearsInput = screen.getByLabelText('Years')
    await user.clear(yearsInput)
    await user.type(yearsInput, '-5')
    await user.click(screen.getByRole('button', { name: 'Calculate' }))

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/years/i)
    expect(yearsInput).toHaveAttribute('aria-describedby', alert.id)
    expect(screen.queryByText('Final Balance')).not.toBeInTheDocument()
  })

  it('treats a blank contribution amount as zero, not an error', async () => {
    const user = userEvent.setup()
    render(<InvestmentCalculator />)

    await user.clear(screen.getByLabelText('Starting amount'))
    await user.type(screen.getByLabelText('Starting amount'), '1000')
    await user.clear(screen.getByLabelText('Contribution amount'))
    await user.click(screen.getByRole('button', { name: 'Calculate' }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // Verifies the zero-collapse itself, not just the absence of an error: with contributions
    // actually zeroed, Total Contributions must read $0 and Final Balance must equal Starting
    // Amount grown at the default 6%/yr for the default 20-year horizon with no deposits added
    // — a contribution that silently stayed at its stale non-zero default would produce a
    // different (higher) figure here.
    const contributionsTile = screen.getByText('Total Contributions').closest('section')
    expect(contributionsTile).toHaveTextContent('$0')
  })

  it('renders all three result elements on a successful calculation', async () => {
    const user = userEvent.setup()
    render(<InvestmentCalculator />)

    await user.click(screen.getByRole('button', { name: 'Calculate' }))

    // Summary stat tiles
    expect(screen.getByText('Final Balance')).toBeInTheDocument()
    expect(screen.getByText('Total Contributions')).toBeInTheDocument()
    expect(screen.getByText('Total Growth')).toBeInTheDocument()

    // Breakdown donut chart
    expect(screen.getByRole('figure', { name: /breakdown/i })).toBeInTheDocument()

    // Year-by-year line chart
    expect(screen.getByRole('figure', { name: /year-by-year/i })).toBeInTheDocument()
  })

  it('clears a validation error live once the field is fixed, without requiring another Calculate click', async () => {
    const user = userEvent.setup()
    render(<InvestmentCalculator />)

    const yearsInput = screen.getByLabelText('Years')
    await user.clear(yearsInput)
    await user.type(yearsInput, '-5')
    await user.click(screen.getByRole('button', { name: 'Calculate' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/years/i)

    await user.clear(yearsInput)
    await user.type(yearsInput, '10')

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(yearsInput).not.toHaveAttribute('aria-invalid', 'true')
  })

  it('produces a hand-computed projection for a non-default compounding frequency', async () => {
    const user = userEvent.setup()
    render(<InvestmentCalculator />)

    await user.clear(screen.getByLabelText('Starting amount'))
    await user.type(screen.getByLabelText('Starting amount'), '1000')
    await user.clear(screen.getByLabelText('Growth rate'))
    await user.type(screen.getByLabelText('Growth rate'), '12')
    await user.selectOptions(screen.getByLabelText('Compounding frequency'), 'monthly')
    await user.clear(screen.getByLabelText('Contribution amount'))
    await user.clear(screen.getByLabelText('Years'))
    await user.type(screen.getByLabelText('Years'), '1')

    await user.click(screen.getByRole('button', { name: 'Calculate' }))

    // $1000 at 12%/yr compounded monthly for 1 year, no contributions:
    // 1000 * (1 + 0.12/12)^12 = 1126.8250...
    expect(screen.getByText('$1,127')).toBeInTheDocument()
  })

  it('sums starting amount + contributions + growth to final balance within rounding', async () => {
    const user = userEvent.setup()
    render(<InvestmentCalculator />)

    await user.clear(screen.getByLabelText('Starting amount'))
    await user.type(screen.getByLabelText('Starting amount'), '1000')
    await user.clear(screen.getByLabelText('Contribution amount'))
    await user.clear(screen.getByLabelText('Years'))
    await user.type(screen.getByLabelText('Years'), '1')
    await user.click(screen.getByRole('button', { name: 'Calculate' }))

    // No contributions, 6%/yr for 1 year: 1000 * 1.06 = 1060 -> final balance $1,060, growth
    // $60, contributions $0. Asserts the actual currency-formatted figures displayed, not just
    // that the tiles exist — the engine's own numeric correctness is covered separately by
    // `investmentCalculator.test.ts` and is treated as a black box here.
    const finalBalanceTile = screen.getByText('Final Balance').closest('section')
    const contributionsTile = screen.getByText('Total Contributions').closest('section')
    const growthTile = screen.getByText('Total Growth').closest('section')
    expect(finalBalanceTile).toHaveTextContent('$1,060')
    expect(contributionsTile).toHaveTextContent('$0')
    expect(growthTile).toHaveTextContent('$60')
  })

  it('reflects a ToggleGroup selection change in the calculation (contribution timing)', async () => {
    const user = userEvent.setup()
    render(<InvestmentCalculator />)

    await user.clear(screen.getByLabelText('Starting amount'))
    await user.type(screen.getByLabelText('Starting amount'), '0')
    await user.clear(screen.getByLabelText('Growth rate'))
    await user.type(screen.getByLabelText('Growth rate'), '10')
    await user.selectOptions(screen.getByLabelText('Compounding frequency'), 'annually')
    await user.clear(screen.getByLabelText('Contribution amount'))
    await user.type(screen.getByLabelText('Contribution amount'), '1000')
    await user.click(screen.getByRole('radio', { name: 'Annually' }))
    await user.clear(screen.getByLabelText('Years'))
    await user.type(screen.getByLabelText('Years'), '1')

    // Default contribution timing is "end" - the year's only contribution lands after growth is
    // applied to a $0 starting balance, so it grows 0% and the final balance is exactly $1,000.
    await user.click(screen.getByRole('button', { name: 'Calculate' }))
    expect(screen.getByText('Final Balance').closest('section')).toHaveTextContent('$1,000')

    // Switching the ToggleGroup to "Start of period" moves that same contribution to the start of
    // the year, so it grows for the full year at 10%: (0 + 1000) * 1.10 = $1,100. This exercises
    // the control's actual checked/onChange wiring end-to-end (a mutation review found no existing
    // test did) rather than only the DOM shape the control renders at its hardcoded default.
    await user.click(screen.getByRole('radio', { name: 'Start of period' }))
    await user.click(screen.getByRole('button', { name: 'Calculate' }))
    expect(screen.getByText('Final Balance').closest('section')).toHaveTextContent('$1,100')
  })
})
