import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { computeFederalTax, STORY_FIXTURES } from '../../../engine/tax'
import type { FederalTaxInput, FederalTaxResult } from '../../../engine'
import { TaxWaterfallChart } from './TaxWaterfallChart'
import { toPixelWidth } from './waterfallLayout'
import { formatCurrency } from '../../utils/format'

const middleIncomeResult = computeFederalTax(STORY_FIXTURES.MiddleIncome)
const zeroTaxResult = computeFederalTax(STORY_FIXTURES.ZeroTax)
const age65Result = computeFederalTax(STORY_FIXTURES.Age65Single)
const seniorBonusResult = computeFederalTax(STORY_FIXTURES.SeniorBonusPhaseOut)
const preferentialResult = computeFederalTax(STORY_FIXTURES.PreferentialHeavy)
const topBracketResult = computeFederalTax(STORY_FIXTURES.TopBracket)
// No story fixture produces a non-zero credit, so build one: $2,000 of credits off MiddleIncome.
const creditsResult: FederalTaxResult = {
  ...middleIncomeResult,
  credits: 2000,
  taxOwed: middleIncomeResult.taxBeforeCredits - 2000,
}

const VIEW_WIDTH = 480 // mirrors the component's viewBox width; a change there should fail these tests

/** The formatted value in the legend row whose label is exactly `label`. */
function legendValue(label: string): string {
  const row = screen.getByText(label).closest('tr')
  if (!row) throw new Error(`no legend row for ${label}`)
  return within(row).getAllByRole('cell')[1].textContent ?? ''
}

/** Drawn (non-track) segment rects for the income bar, tax bar and FICA bar, in DOM order. */
function drawnRects(container: HTMLElement) {
  const rects = Array.from(container.querySelectorAll('svg rect')).map((r) => ({
    x: Number(r.getAttribute('x')),
    width: Number(r.getAttribute('width')),
    cls: r.getAttribute('class') ?? '',
  }))
  const fills = rects.filter((r) => !r.cls.includes('barTrack'))
  return { rects, income: fills.slice(0, 3), tax: fills.slice(3, 5), fica: fills[5] }
}

// Covers rendering, legend values, drawn rect geometry/role classes, a11y attributes, and the
// ERD §8.4 source scan. Colors/CSS and pixel-level appearance are covered by the Ladle visual
// snapshots, not here.
describe('TaxWaterfallChart', () => {
  afterEach(() => cleanup())

  it('renders a titled figure whose accessible name comes from `title`', () => {
    render(<TaxWaterfallChart result={middleIncomeResult} title="Single filer, 2026" />)
    expect(screen.getByRole('figure', { name: 'Single filer, 2026' })).toBeInTheDocument()
  })

  it('renders a legend row for every segment with its exact formatted dollar value', () => {
    render(<TaxWaterfallChart result={creditsResult} title="Single filer, 2026" />)
    const r = creditsResult
    expect(legendValue('Gross income')).toBe(formatCurrency(120000))
    expect(legendValue('Standard deduction')).toBe(formatCurrency(r.deduction.standardDeduction))
    expect(legendValue('Senior bonus deduction')).toBe(formatCurrency(0))
    expect(legendValue('Taxable income')).toBe(formatCurrency(r.taxableIncome))
    expect(legendValue('Tax before credits')).toBe(formatCurrency(r.taxBeforeCredits))
    expect(legendValue('Credits')).toBe(formatCurrency(2000))
    expect(legendValue('Tax owed')).toBe(formatCurrency(r.taxBeforeCredits - 2000))
    expect(legendValue('FICA — Social Security')).toBe(formatCurrency(r.fica.socialSecurity))
    expect(legendValue('FICA — Medicare')).toBe(formatCurrency(r.fica.medicare))
    expect(legendValue('FICA — Additional Medicare')).toBe(formatCurrency(0))
    expect(legendValue('FICA total')).toBe(formatCurrency(r.fica.total))
  })

  it('gross income legend value includes preferential income', () => {
    render(<TaxWaterfallChart result={preferentialResult} title="Preferential" />)
    expect(preferentialResult.grossPreferentialIncome).toBeGreaterThan(0)
    expect(legendValue('Gross income')).toBe(formatCurrency(410000))
  })

  it('shows non-zero Additional Medicare in the legend for a top-bracket earner', () => {
    render(<TaxWaterfallChart result={topBracketResult} title="Top" />)
    expect(legendValue('FICA — Additional Medicare')).toBe(formatCurrency(6300))
    expect(legendValue('FICA — Medicare')).toBe(formatCurrency(13050))
  })

  it('shows a combined total tax liability figure (income tax + FICA)', () => {
    render(<TaxWaterfallChart result={middleIncomeResult} title="Single filer, 2026" />)
    const total = middleIncomeResult.taxOwed + middleIncomeResult.fica.total
    expect(total).toBe(17570 + 9180)
    expect(screen.getByText(/Total tax liability/)).toBeInTheDocument()
    expect(screen.getByText(formatCurrency(total))).toBeInTheDocument()
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
    expect(legendValue('Senior bonus deduction')).toBe('$0')
  })

  it('shows FICA as its own legend total, distinct from income tax owed', () => {
    render(<TaxWaterfallChart result={middleIncomeResult} title="Single filer, 2026" />)
    expect(legendValue('FICA total')).toBe(formatCurrency(9180))
    expect(legendValue('Tax owed')).toBe(formatCurrency(17570))
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

  it('hides every decorative bar svg from assistive tech', () => {
    const { container } = render(<TaxWaterfallChart result={middleIncomeResult} title="t" />)
    const svgs = container.querySelectorAll('svg')
    expect(svgs).toHaveLength(3)
    for (const svg of svgs) expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('labels each bar row with its name and formatted total (HTML text, not SVG text)', () => {
    const { container } = render(<TaxWaterfallChart result={creditsResult} title="t" />)
    expect(container.querySelector('svg text')).toBeNull()
    expect(screen.getByText('Gross income → taxable income: $120,000')).toBeInTheDocument()
    expect(
      screen.getByText(`Tax before credits → tax owed: ${formatCurrency(creditsResult.taxBeforeCredits)}`),
    ).toBeInTheDocument()
    expect(screen.getByText(`FICA: ${formatCurrency(9180)}`)).toBeInTheDocument()
  })

  it('renders the legend header row and swatches matching each segment role', () => {
    render(<TaxWaterfallChart result={seniorBonusResult} title="t" />)
    expect(screen.getByRole('columnheader', { name: 'Segment' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Amount' })).toBeInTheDocument()
    const swatchOf = (label: string) =>
      screen.getByText(label).closest('tr')?.querySelector('span[aria-hidden="true"]')?.className ?? ''
    expect(swatchOf('Senior bonus deduction')).toContain('swatchReductionBonus')
    expect(swatchOf('Standard deduction')).toContain('swatchReduction')
    expect(swatchOf('Standard deduction')).not.toContain('swatchReductionBonus')
    expect(swatchOf('Taxable income')).toContain('swatchBase')
    expect(swatchOf('FICA total')).toContain('swatchFica')
    expect(swatchOf('Gross income')).toBe('')
  })

  it('draws income segments side by side with widths proportional to gross income', () => {
    const r = middleIncomeResult
    const { container } = render(<TaxWaterfallChart result={r} title="t" />)
    const { income } = drawnRects(container)
    const gross = r.grossOrdinaryIncome + r.grossPreferentialIncome
    const w = [r.deduction.standardDeduction, r.deduction.seniorBonusDeduction, r.taxableIncome].map(
      (v) => (v / gross) * VIEW_WIDTH,
    )
    expect(income.map((i) => i.width)).toEqual(w)
    expect(income[0].x).toBe(0)
    expect(income[1].x).toBeCloseTo(w[0])
    expect(income[2].x).toBeCloseTo(w[0] + w[1])
    expect(w[0] + w[1] + w[2]).toBeCloseTo(VIEW_WIDTH)
  })

  it('draws tax segments (credits, tax owed) scaled against tax before credits', () => {
    const r = creditsResult
    const { container } = render(<TaxWaterfallChart result={r} title="t" />)
    const { tax } = drawnRects(container)
    const credits = (2000 / r.taxBeforeCredits) * VIEW_WIDTH
    expect(tax[0]).toMatchObject({ x: 0 })
    expect(tax[0].width).toBeCloseTo(credits)
    expect(tax[1].x).toBeCloseTo(credits)
    expect(tax[1].width).toBeCloseTo(VIEW_WIDTH - credits)
  })

  it('draws the FICA fill at full track width, independent of the income-tax scale', () => {
    const { container } = render(<TaxWaterfallChart result={topBracketResult} title="t" />)
    const { fica, rects } = drawnRects(container)
    expect(fica.width).toBe(VIEW_WIDTH)
    expect(fica.x).toBe(0)
    for (const track of rects.filter((r) => r.cls.includes('barTrack'))) {
      expect(track.width).toBe(VIEW_WIDTH)
    }
  })

  it('assigns role classes: standard deduction, senior bonus tint, base, credits', () => {
    const { container } = render(<TaxWaterfallChart result={seniorBonusResult} title="t" />)
    const { income, tax, fica } = drawnRects(container)
    expect(income[0].cls).toContain('segmentReduction')
    expect(income[0].cls).not.toContain('segmentReductionBonus')
    expect(income[1].cls).toContain('segmentReductionBonus')
    expect(income[2].cls).toContain('segmentBase')
    expect(tax[0].cls).toContain('segmentReduction')
    expect(tax[1].cls).toContain('segmentBase')
    expect(fica.cls).toContain('segmentFica')
  })

  it('does not throw and still shows all rows for the ZeroTax scenario (income below the deduction)', () => {
    render(<TaxWaterfallChart result={zeroTaxResult} title="Zero tax" />)
    expect(screen.getByRole('figure', { name: 'Zero tax' })).toBeInTheDocument()
    expect(legendValue('Taxable income')).toBe('$0')
    expect(legendValue('Tax owed')).toBe('$0')
  })

  describe('toPixelWidth', () => {
    // Every real `FederalTaxResult` value this is ever called with is non-negative, but a
    // deduction CAN legitimately exceed its bar's scale (gross income) when deductions exceed
    // income — this unit-tests the clamp itself directly since that's the load-bearing path, plus
    // the other adverse-input cases as defense-in-depth (see the doc comment on `toPixelWidth`).
    it('clamps a negative dollar value to zero pixels', () => {
      expect(toPixelWidth(-500, 1000, 150)).toBe(0)
    })

    it('clamps a value above scaleMax to the full band extent', () => {
      const width = toPixelWidth(5000, 1000, 150)
      expect(width).toBeGreaterThan(0)
      expect(width).toBe(toPixelWidth(1000, 1000, 150))
    })

    it('returns zero, not NaN or Infinity, when scaleMax is zero or negative', () => {
      expect(toPixelWidth(100, 0, 150)).toBe(0)
      expect(toPixelWidth(100, -1, 150)).toBe(0)
    })

    it('scales linearly within range', () => {
      expect(toPixelWidth(500, 1000, 150)).toBe(toPixelWidth(1000, 1000, 150) / 2)
    })
  })

  it('renders correctly for the mid-phase-out senior bonus scenario', () => {
    render(<TaxWaterfallChart result={seniorBonusResult} title="Senior bonus phase-out" />)
    expect(seniorBonusResult.deduction.seniorBonusDeduction).toBeGreaterThan(0)
    expect(legendValue('Senior bonus deduction')).toBe(formatCurrency(4500))
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
