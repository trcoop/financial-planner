import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import {
  AdvancedAssumptionsForm,
  DEFAULT_ADVANCED_VALUES,
  type AdvancedAssumptionValues,
} from './AdvancedAssumptionsForm'

const DEFAULT_VALUES: AdvancedAssumptionValues = {
  annualRaisePercent: 3,
  annualReturnPercent: 7,
  inflationPercent: 2.5,
  withdrawalRatePercent: 4,
  stocksAllocationPercent: 70,
  bondReturnPercent: 4.5,
}

function ControlledForm({ initial = DEFAULT_VALUES }: { initial?: AdvancedAssumptionValues }) {
  const [values, setValues] = useState(initial)
  return <AdvancedAssumptionsForm values={values} onChange={setValues} />
}

describe('AdvancedAssumptionsForm', () => {
  afterEach(() => cleanup())

  it('renders inside a collapsible section labeled "Advanced assumptions", collapsed by default', () => {
    render(<AdvancedAssumptionsForm values={DEFAULT_VALUES} onChange={vi.fn()} />)
    expect(screen.getByText('▸ Advanced assumptions')).toBeInTheDocument()
    const details = screen.getByText('▸ Advanced assumptions').closest('details')
    expect(details).not.toHaveAttribute('open')
  })

  it('reveals the 6 advanced inputs with clear labels once expanded', async () => {
    const user = userEvent.setup()
    render(<AdvancedAssumptionsForm values={DEFAULT_VALUES} onChange={vi.fn()} />)

    await user.click(screen.getByText('▸ Advanced assumptions'))

    expect(screen.getByLabelText('Expected annual raise')).toBeInTheDocument()
    expect(screen.getByLabelText('Stock return assumption')).toBeInTheDocument()
    expect(screen.getByLabelText('Inflation rate')).toBeInTheDocument()
    expect(screen.getByLabelText('Withdrawal rate in retirement')).toBeInTheDocument()
    expect(screen.getByLabelText('Stock allocation (vs. bonds)')).toBeInTheDocument()
    expect(screen.getByLabelText('Bond return assumption')).toBeInTheDocument()
  })

  it('renders Bond return assumption immediately after Stock return assumption (FIN-58)', async () => {
    const user = userEvent.setup()
    const { container } = render(<AdvancedAssumptionsForm values={DEFAULT_VALUES} onChange={vi.fn()} />)

    await user.click(screen.getByText('▸ Advanced assumptions'))

    const labels = Array.from(container.querySelectorAll('label')).map((el) => el.textContent)
    const stockIndex = labels.indexOf('Stock return assumption')
    const bondIndex = labels.indexOf('Bond return assumption')

    expect(stockIndex).toBeGreaterThanOrEqual(0)
    expect(bondIndex).toBe(stockIndex + 1)
  })

  it('pre-fills the FIN-10 default values, the FIN-56 default 70/30 stock/bond split, and the FIN-57 default 4.5% bond return', async () => {
    const user = userEvent.setup()
    render(<AdvancedAssumptionsForm values={DEFAULT_VALUES} onChange={vi.fn()} />)
    await user.click(screen.getByText('▸ Advanced assumptions'))

    expect(screen.getByLabelText('Expected annual raise')).toHaveValue('3%')
    expect(screen.getByLabelText('Stock return assumption')).toHaveValue('7%')
    expect(screen.getByLabelText('Inflation rate')).toHaveValue('2.5%')
    expect(screen.getByLabelText('Withdrawal rate in retirement')).toHaveValue('4%')
    expect(screen.getByLabelText('Stock allocation (vs. bonds)')).toHaveValue('70%')
    expect(screen.getByLabelText('Bond return assumption')).toHaveValue('4.5%')
  })

  it('calls onChange with the updated stock allocation, preserving the rest', async () => {
    const onChange = vi.fn()
    render(<AdvancedAssumptionsForm values={DEFAULT_VALUES} onChange={onChange} />)
    await userEvent.setup().click(screen.getByText('▸ Advanced assumptions'))

    const allocation = screen.getByLabelText('Stock allocation (vs. bonds)')
    fireEvent.change(allocation, { target: { value: '80' } })

    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_VALUES, stocksAllocationPercent: 80 })
  })

  it('defaults the stock allocation to 70/30 stocks/bonds (FIN-56)', () => {
    expect(DEFAULT_ADVANCED_VALUES.stocksAllocationPercent).toBe(70)
  })

  it('defaults the bond return assumption to 4.5% (FIN-57)', () => {
    expect(DEFAULT_ADVANCED_VALUES.bondReturnPercent).toBe(4.5)
  })

  it('calls onChange with the updated bond return, preserving the rest', async () => {
    const onChange = vi.fn()
    render(<AdvancedAssumptionsForm values={DEFAULT_VALUES} onChange={onChange} />)
    await userEvent.setup().click(screen.getByText('▸ Advanced assumptions'))

    const bondReturn = screen.getByLabelText('Bond return assumption')
    fireEvent.change(bondReturn, { target: { value: '5.5' } })

    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_VALUES, bondReturnPercent: 5.5 })
  })

  it('enforces the same -50 to 100 range on bond return as the stock return field', async () => {
    const user = userEvent.setup()
    render(<AdvancedAssumptionsForm values={DEFAULT_VALUES} onChange={vi.fn()} />)
    await user.click(screen.getByText('▸ Advanced assumptions'))

    expect(screen.getByLabelText('Bond return assumption')).toHaveAttribute('min', '-50')
    expect(screen.getByLabelText('Bond return assumption')).toHaveAttribute('max', '100')
  })

  it('enforces a 1-99 range on stock allocation, so both legs always keep positive weight', async () => {
    const user = userEvent.setup()
    render(<AdvancedAssumptionsForm values={DEFAULT_VALUES} onChange={vi.fn()} />)
    await user.click(screen.getByText('▸ Advanced assumptions'))

    expect(screen.getByLabelText('Stock allocation (vs. bonds)')).toHaveAttribute('min', '1')
    expect(screen.getByLabelText('Stock allocation (vs. bonds)')).toHaveAttribute('max', '99')
  })

  it('enforces the FIN-10 ranges via min/max, including negative bounds for return and inflation', async () => {
    const user = userEvent.setup()
    render(<AdvancedAssumptionsForm values={DEFAULT_VALUES} onChange={vi.fn()} />)
    await user.click(screen.getByText('▸ Advanced assumptions'))

    expect(screen.getByLabelText('Expected annual raise')).toHaveAttribute('min', '0')
    expect(screen.getByLabelText('Expected annual raise')).toHaveAttribute('max', '100')
    expect(screen.getByLabelText('Stock return assumption')).toHaveAttribute('min', '-50')
    expect(screen.getByLabelText('Stock return assumption')).toHaveAttribute('max', '100')
    expect(screen.getByLabelText('Inflation rate')).toHaveAttribute('min', '-50')
    expect(screen.getByLabelText('Inflation rate')).toHaveAttribute('max', '100')
    expect(screen.getByLabelText('Withdrawal rate in retirement')).toHaveAttribute('min', '0')
    expect(screen.getByLabelText('Withdrawal rate in retirement')).toHaveAttribute('max', '100')
  })

  it('shows a validation error when a value is entered out of range', async () => {
    const user = userEvent.setup()
    render(<ControlledForm />)
    await user.click(screen.getByText('▸ Advanced assumptions'))

    const returnField = screen.getByLabelText('Stock return assumption')
    fireEvent.change(returnField, { target: { value: '-60' } })

    expect(returnField).toHaveValue('-60%')
    expect(screen.getByRole('alert')).toHaveTextContent(/between -50 and 100/i)
  })

  it('clears the validation error once the value is back in range', async () => {
    const user = userEvent.setup()
    render(<ControlledForm />)
    await user.click(screen.getByText('▸ Advanced assumptions'))

    const returnField = screen.getByLabelText('Stock return assumption')
    fireEvent.change(returnField, { target: { value: '-60' } })
    expect(screen.getByRole('alert')).toBeInTheDocument()

    fireEvent.change(returnField, { target: { value: '5' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('calls onChange with the updated field only, preserving the rest', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<AdvancedAssumptionsForm values={DEFAULT_VALUES} onChange={onChange} />)
    await user.click(screen.getByText('▸ Advanced assumptions'))

    const raise = screen.getByLabelText('Expected annual raise')
    fireEvent.change(raise, { target: { value: '5' } })

    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_VALUES, annualRaisePercent: 5 })
  })

  it('preserves entered values across collapse/expand', async () => {
    const user = userEvent.setup()
    render(<ControlledForm />)
    await user.click(screen.getByText('▸ Advanced assumptions'))

    const raise = screen.getByLabelText('Expected annual raise')
    fireEvent.change(raise, { target: { value: '5' } })
    expect(raise).toHaveValue('5%')

    // collapse
    await user.click(screen.getByText('▸ Advanced assumptions'))
    // expand again
    await user.click(screen.getByText('▸ Advanced assumptions'))

    expect(screen.getByLabelText('Expected annual raise')).toHaveValue('5%')
  })

  it('formats all 6 fields with a % suffix', async () => {
    const user = userEvent.setup()
    render(<AdvancedAssumptionsForm values={DEFAULT_VALUES} onChange={vi.fn()} />)
    await user.click(screen.getByText('▸ Advanced assumptions'))

    expect(screen.getByLabelText('Expected annual raise')).toHaveValue('3%')
    expect(screen.getByLabelText('Stock return assumption')).toHaveValue('7%')
    expect(screen.getByLabelText('Inflation rate')).toHaveValue('2.5%')
    expect(screen.getByLabelText('Withdrawal rate in retirement')).toHaveValue('4%')
    expect(screen.getByLabelText('Stock allocation (vs. bonds)')).toHaveValue('70%')
    expect(screen.getByLabelText('Bond return assumption')).toHaveValue('4.5%')
  })
})
