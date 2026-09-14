import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { computeFederalTax, STORY_FIXTURES } from '../../../engine/tax'
import type { FederalTaxInput } from '../../../engine'
import { TaxWaterfallChart } from './TaxWaterfallChart'
import { toPixelHeight } from './waterfallLayout'
import { formatCurrency } from '../../utils/format'

const middleIncomeResult = computeFederalTax(STORY_FIXTURES.MiddleIncome)
const zeroTaxResult = computeFederalTax(STORY_FIXTURES.ZeroTax)
const age65Result = computeFederalTax(STORY_FIXTURES.Age65Single)
const seniorBonusResult = computeFederalTax(STORY_FIXTURES.SeniorBonusPhaseOut)

describe('TaxWaterfallChart', () => {
  afterEach(() => cleanup())

  it('renders a titled figure whose accessible name comes from `title`', () => {
    render(<TaxWaterfallChart result={middleIncomeResult} title="Single filer, 2026" />)
    expect(screen.getByRole('figure', { name: 'Single filer, 2026' })).toBeInTheDocument()
  })

  it('renders a legend/table row for every waterfall segment with its formatted dollar value', () => {
    render(<TaxWaterfallChart result={middleIncomeResult} title="Single filer, 2026" />)
    expect(screen.getByText('Gross income')).toBeInTheDocument()
    expect(screen.getByText('Standard deduction')).toBeInTheDocument()
    expect(screen.getByText('Senior bonus deduction')).toBeInTheDocument()
    expect(screen.getByText('Taxable income')).toBeInTheDocument()
    expect(screen.getByText('Tax before credits')).toBeInTheDocument()
    expect(screen.getByText('Credits')).toBeInTheDocument()
    expect(screen.getByText('Tax owed')).toBeInTheDocument()

    const grossIncome =
      middleIncomeResult.grossOrdinaryIncome + middleIncomeResult.grossPreferentialIncome
    expect(screen.getAllByText(formatCurrency(grossIncome)).length).toBeGreaterThan(0)
    expect(screen.getAllByText(formatCurrency(middleIncomeResult.taxOwed)).length).toBeGreaterThan(0)
  })

  it('shows a combined total tax liability figure (income tax + FICA)', () => {
    render(<TaxWaterfallChart result={middleIncomeResult} title="Single filer, 2026" />)
    const total = middleIncomeResult.taxOwed + middleIncomeResult.fica.total
    expect(screen.getByText(/Total tax liability/)).toBeInTheDocument()
    expect(screen.getAllByText(formatCurrency(total)).length).toBeGreaterThan(0)
  })

  it('shows the standard deduction and senior bonus deduction as separate rows, never merged', () => {
    render(<TaxWaterfallChart result={age65Result} title="Age 65 single" />)
    const standardRow = screen.getByText('Standard deduction').closest('tr,li,div')
    const bonusRow = screen.getByText('Senior bonus deduction').closest('tr,li,div')
    expect(standardRow).not.toBe(bonusRow)
  })

  it('renders senior bonus deduction as its own row even when its value is zero', () => {
    render(<TaxWaterfallChart result={middleIncomeResult} title="Single filer, 2026" />)
    expect(middleIncomeResult.deduction.seniorBonusDeduction).toBe(0)
    expect(screen.getByText('Senior bonus deduction')).toBeInTheDocument()
    expect(screen.getAllByText('$0').length).toBeGreaterThan(0)
  })

  it('shows FICA as a distinct line, not folded into the income-tax bars', () => {
    render(<TaxWaterfallChart result={middleIncomeResult} title="Single filer, 2026" />)
    expect(screen.getAllByText(/FICA/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(formatCurrency(middleIncomeResult.fica.total)).length).toBeGreaterThan(0)
  })

  it('renders the income bar, tax bar, and FICA bar as separate, non-stacked SVG groups', () => {
    const { container } = render(
      <TaxWaterfallChart result={middleIncomeResult} title="Single filer, 2026" />,
    )
    // 2 bar "tracks" (background) + 3 income segments + 2 tax segments = 5 filled segment rects,
    // plus a FICA track + FICA fill = 2 more. Tracks: income, tax, fica = 3.
    // Total rects = 3 tracks + 3 income segments + 2 tax segments + 1 fica fill = 9.
    expect(container.querySelectorAll('svg rect')).toHaveLength(9)
  })

  it('does not throw and still shows all rows for the ZeroTax scenario (income below the deduction)', () => {
    render(<TaxWaterfallChart result={zeroTaxResult} title="Zero tax" />)
    expect(screen.getByRole('figure', { name: 'Zero tax' })).toBeInTheDocument()
    expect(screen.getAllByText('$0').length).toBeGreaterThan(0)
  })

  describe('toPixelHeight', () => {
    // Every real `FederalTaxResult` value this is ever called with is non-negative, but a
    // deduction CAN legitimately exceed its bar's scale (gross income) when deductions exceed
    // income — this unit-tests the clamp itself directly since that's the load-bearing path, plus
    // the other adverse-input cases as defense-in-depth (see the doc comment on `toPixelHeight`).
    it('clamps a negative dollar value to zero pixels', () => {
      expect(toPixelHeight(-500, 1000, 150)).toBe(0)
    })

    it('clamps a value above scaleMax to the full band extent', () => {
      const width = toPixelHeight(5000, 1000, 150)
      expect(width).toBeGreaterThan(0)
      expect(width).toBe(toPixelHeight(1000, 1000, 150))
    })

    it('returns zero, not NaN or Infinity, when scaleMax is zero or negative', () => {
      expect(toPixelHeight(100, 0, 150)).toBe(0)
      expect(toPixelHeight(100, -1, 150)).toBe(0)
    })

    it('scales linearly within range', () => {
      expect(toPixelHeight(500, 1000, 150)).toBe(toPixelHeight(1000, 1000, 150) / 2)
    })
  })

  it('renders correctly for the mid-phase-out senior bonus scenario', () => {
    render(<TaxWaterfallChart result={seniorBonusResult} title="Senior bonus phase-out" />)
    expect(seniorBonusResult.deduction.seniorBonusDeduction).toBeGreaterThan(0)
    expect(
      screen.getAllByText(formatCurrency(seniorBonusResult.deduction.seniorBonusDeduction)).length,
    ).toBeGreaterThan(0)
  })

  it('never imports engine/tax/tables.ts or references TAX_TABLES from its own source file (ERD §8.4)', () => {
    // Deliberately a literal textual scan, not an import-statement parse: ERD §8.4 says "no
    // reference to TAX_TABLES", not "no import of it", so a stray mention anywhere in this file
    // (including a comment) is exactly what this is meant to catch — the strictness is
    // intentional, not an oversight of a narrower "imports only" check.
    const source = readFileSync(
      join(process.cwd(), 'src/ui/components/TaxWaterfallChart/TaxWaterfallChart.tsx'),
      'utf-8',
    )
    expect(source).not.toMatch(/tables(\.ts)?['"]/)
    expect(source).not.toMatch(/TAX_TABLES/)
  })

  it('type-checks against a FederalTaxInput-derived result without the component importing engine/tax directly', () => {
    // Compile-time check: `result` accepts the public `FederalTaxResult` from `src/engine`.
    const input: FederalTaxInput = STORY_FIXTURES.MiddleIncome
    const result = computeFederalTax(input)
    render(<TaxWaterfallChart result={result} title="Type check" />)
    expect(screen.getByRole('figure', { name: 'Type check' })).toBeInTheDocument()
  })
})
