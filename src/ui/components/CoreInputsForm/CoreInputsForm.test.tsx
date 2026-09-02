import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CoreInputsForm, type CoreInputValues } from './CoreInputsForm'

const DEFAULT_VALUES: CoreInputValues = {
  currentAge: 35,
  retirementAge: 67,
  initialBalance: 250000,
  currentAnnualIncome: 85000,
  annualContributionRatePercent: 15,
}

function ControlledForm({ initial = DEFAULT_VALUES }: { initial?: CoreInputValues }) {
  const [values, setValues] = useState(initial)
  return <CoreInputsForm values={values} onChange={setValues} />
}

describe('CoreInputsForm', () => {
  afterEach(() => cleanup())

  // FIN-116: currentAge/retirementAge/currentAnnualIncome moved to the People tab's primary
  // Person fields ("Current age"/"Retirement age"/"Salary" there, synced into `CoreInputValues`
  // by PlanSection — see `syncCoreWithPrimary`) so they're no longer rendered here;
  // CoreInputsForm keeps the 2 remaining plan-assumption fields that Person has no equivalent
  // for.
  it('renders the 2 remaining core inputs in order with clear labels', () => {
    render(<CoreInputsForm values={DEFAULT_VALUES} onChange={vi.fn()} />)
    expect(screen.getByLabelText('Current investment balance')).toBeInTheDocument()
    expect(screen.getByLabelText('Annual savings percentage')).toBeInTheDocument()
    expect(screen.queryByLabelText('Current age')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Retirement age')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Current annual income')).not.toBeInTheDocument()

    const inputs = screen.getAllByRole('textbox')
    expect(inputs.map((i) => i.getAttribute('id'))).toEqual([
      screen.getByLabelText('Current investment balance').id,
      screen.getByLabelText('Annual savings percentage').id,
    ])
  })

  it('pre-fills the sensible defaults on first load', () => {
    render(<CoreInputsForm values={DEFAULT_VALUES} onChange={vi.fn()} />)
    expect(screen.getByLabelText('Current investment balance')).toHaveValue('$250,000')
    expect(screen.getByLabelText('Annual savings percentage')).toHaveValue('15%')
  })

  it('enforces input ranges via min/max', () => {
    render(<CoreInputsForm values={DEFAULT_VALUES} onChange={vi.fn()} />)
    expect(screen.getByLabelText('Current investment balance')).toHaveAttribute('min', '0')
    expect(screen.getByLabelText('Current investment balance')).toHaveAttribute('max', '10000000')
    expect(screen.getByLabelText('Annual savings percentage')).toHaveAttribute('min', '0')
    expect(screen.getByLabelText('Annual savings percentage')).toHaveAttribute('max', '100')
  })

  it('shows a validation error when a value is entered out of range, and calls onChange anyway', () => {
    render(<ControlledForm />)

    const balance = screen.getByLabelText('Current investment balance')
    fireEvent.change(balance, { target: { value: '90000000' } })

    expect(balance).toHaveValue('$90,000,000')
    expect(screen.getByRole('alert')).toHaveTextContent(/between 0 and 10,000,000/i)
  })

  it('clears the validation error once the value is back in range', () => {
    render(<ControlledForm />)

    const balance = screen.getByLabelText('Current investment balance')
    fireEvent.change(balance, { target: { value: '90000000' } })
    expect(screen.getByRole('alert')).toBeInTheDocument()

    fireEvent.change(balance, { target: { value: '900000' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('formats the balance field with a $ prefix', () => {
    render(<CoreInputsForm values={DEFAULT_VALUES} onChange={vi.fn()} />)
    expect(screen.getByLabelText('Current investment balance')).toHaveValue('$250,000')
  })

  it('formats the savings percentage field with a % suffix', () => {
    render(<CoreInputsForm values={DEFAULT_VALUES} onChange={vi.fn()} />)
    expect(screen.getByLabelText('Annual savings percentage')).toHaveValue('15%')
  })

  it('calls onChange with the updated field only, preserving the rest', () => {
    const onChange = vi.fn()
    render(<CoreInputsForm values={DEFAULT_VALUES} onChange={onChange} />)

    const balance = screen.getByLabelText('Current investment balance')
    fireEvent.change(balance, { target: { value: '300000' } })

    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_VALUES, initialBalance: 300000 })
  })

  // jsdom (this project's Vitest environment) doesn't load real stylesheets or evaluate
  // `@media` — `vite.config.ts` test config has no `css: true` — so this reads the desktop
  // `@media (min-width: 960px)` block out of the CSS module source directly, mirroring
  // TabBar.test.tsx's convention. Fails if the two-column pairing (FIN-101) regresses back to
  // one full-width field per row.
  describe('desktop field pairing (>= 960px), via CoreInputsForm.module.css source', () => {
    const cssPath = fileURLToPath(import.meta.url).replace(
      /CoreInputsForm\.test\.tsx$/,
      'CoreInputsForm.module.css',
    )
    const css = readFileSync(cssPath, 'utf-8')
    const desktopBlockMatch = css.match(/@media \(min-width: 960px\) \{([\s\S]*)\}\s*$/)
    const desktopBlock = desktopBlockMatch?.[1] ?? ''

    it('has a desktop @media block to inspect (sanity check for the regex below)', () => {
      expect(desktopBlock.length).toBeGreaterThan(0)
    })

    it('pairs fields two-to-a-row on desktop', () => {
      expect(desktopBlock).toMatch(/\.form\s*\{[^}]*grid-template-columns:\s*1fr 1fr;/)
    })
  })
})
