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

  it('renders the 5 core inputs in order with clear labels', () => {
    render(<CoreInputsForm values={DEFAULT_VALUES} onChange={vi.fn()} />)
    expect(screen.getByLabelText('Current age')).toBeInTheDocument()
    expect(screen.getByLabelText('Retirement age')).toBeInTheDocument()
    expect(screen.getByLabelText('Current investment balance')).toBeInTheDocument()
    expect(screen.getByLabelText('Current annual income')).toBeInTheDocument()
    expect(screen.getByLabelText('Annual savings percentage')).toBeInTheDocument()

    const inputs = screen.getAllByRole('textbox')
    expect(inputs.map((i) => i.getAttribute('id'))).toEqual([
      screen.getByLabelText('Current age').id,
      screen.getByLabelText('Retirement age').id,
      screen.getByLabelText('Current investment balance').id,
      screen.getByLabelText('Current annual income').id,
      screen.getByLabelText('Annual savings percentage').id,
    ])
  })

  it('pre-fills the sensible defaults on first load', () => {
    render(<CoreInputsForm values={DEFAULT_VALUES} onChange={vi.fn()} />)
    expect(screen.getByLabelText('Current age')).toHaveValue('35')
    expect(screen.getByLabelText('Retirement age')).toHaveValue('67')
    expect(screen.getByLabelText('Current investment balance')).toHaveValue('$250,000')
    expect(screen.getByLabelText('Current annual income')).toHaveValue('$85,000')
    expect(screen.getByLabelText('Annual savings percentage')).toHaveValue('15%')
  })

  it('enforces input ranges via min/max', () => {
    render(<CoreInputsForm values={DEFAULT_VALUES} onChange={vi.fn()} />)
    expect(screen.getByLabelText('Current age')).toHaveAttribute('min', '18')
    expect(screen.getByLabelText('Current age')).toHaveAttribute('max', '100')
    expect(screen.getByLabelText('Retirement age')).toHaveAttribute('min', '18')
    expect(screen.getByLabelText('Retirement age')).toHaveAttribute('max', '100')
    expect(screen.getByLabelText('Current investment balance')).toHaveAttribute('min', '0')
    expect(screen.getByLabelText('Current investment balance')).toHaveAttribute('max', '10000000')
    expect(screen.getByLabelText('Current annual income')).toHaveAttribute('min', '0')
    expect(screen.getByLabelText('Current annual income')).toHaveAttribute('max', '5000000')
    expect(screen.getByLabelText('Annual savings percentage')).toHaveAttribute('min', '0')
    expect(screen.getByLabelText('Annual savings percentage')).toHaveAttribute('max', '100')
  })

  it('shows a validation error when a value is entered out of range, and calls onChange anyway', () => {
    render(<ControlledForm />)

    const income = screen.getByLabelText('Current annual income')
    fireEvent.change(income, { target: { value: '9000000' } })

    expect(income).toHaveValue('$9,000,000')
    expect(screen.getByRole('alert')).toHaveTextContent(/between 0 and 5,000,000/i)
  })

  it('clears the validation error once the value is back in range', () => {
    render(<ControlledForm />)

    const income = screen.getByLabelText('Current annual income')
    fireEvent.change(income, { target: { value: '9000000' } })
    expect(screen.getByRole('alert')).toBeInTheDocument()

    fireEvent.change(income, { target: { value: '90000' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('formats balance and income fields with a $ prefix', () => {
    render(<CoreInputsForm values={DEFAULT_VALUES} onChange={vi.fn()} />)
    expect(screen.getByLabelText('Current investment balance')).toHaveValue('$250,000')
    expect(screen.getByLabelText('Current annual income')).toHaveValue('$85,000')
  })

  it('formats the savings percentage field with a % suffix', () => {
    render(<CoreInputsForm values={DEFAULT_VALUES} onChange={vi.fn()} />)
    expect(screen.getByLabelText('Annual savings percentage')).toHaveValue('15%')
  })

  it('calls onChange with the updated field only, preserving the rest', () => {
    const onChange = vi.fn()
    render(<CoreInputsForm values={DEFAULT_VALUES} onChange={onChange} />)

    const age = screen.getByLabelText('Current age')
    fireEvent.change(age, { target: { value: '40' } })

    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_VALUES, currentAge: 40 })
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
