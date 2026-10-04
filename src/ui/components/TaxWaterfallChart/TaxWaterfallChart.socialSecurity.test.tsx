import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { computeFederalTax, STORY_FIXTURES } from '../../../engine/tax'
import { TaxWaterfallChart } from './TaxWaterfallChart'
import { SS_CAPPED_85, SS_NONE_TAXABLE, SS_PARTIAL_TAXABLE } from './ssFixtures'
import { formatCurrency } from '../../utils/format'

const VIEW_WIDTH = 480 // mirrors the component's viewBox width

function legendValue(label: string): string {
  const row = screen.getByText(label).closest('tr')
  if (!row) throw new Error(`no legend row for ${label}`)
  return within(row).getAllByRole('cell')[1].textContent ?? ''
}
const money = (t: string) => Number(t.replace(/[^0-9.-]/g, ''))

describe('TaxWaterfallChart Social Security segment', () => {
  afterEach(() => cleanup())

  const cases = [
    { name: 'T2 none taxable', input: SS_NONE_TAXABLE, pi: 25_000, taxable: 0, notTaxed: 20_000 },
    { name: 'T6 partial taxable', input: SS_PARTIAL_TAXABLE, pi: 40_000, taxable: 9_600, notTaxed: 10_400 },
    { name: 'T7 85% cap', input: SS_CAPPED_85, pi: 110_000, taxable: 17_000, notTaxed: 3_000 },
  ]

  for (const c of cases) {
    it(`${c.name}: engine values and legend rows`, () => {
      const result = computeFederalTax(c.input)
      expect(result.grossSocialSecurity).toBe(20_000)
      expect(result.provisionalIncome).toBe(c.pi)
      expect(result.taxableSocialSecurity).toBe(c.taxable)
      render(<TaxWaterfallChart result={result} title="t" />)
      expect(legendValue('Social Security — taxable')).toBe(formatCurrency(c.taxable))
      expect(legendValue('Social Security — not taxed')).toBe(formatCurrency(c.notTaxed))
      expect(legendValue('Social Security — gross')).toBe(formatCurrency(20_000))
    })

    it(`${c.name}: SS segments sum exactly to gross; legend total within $1 of bar total`, () => {
      const result = computeFederalTax(c.input)
      const { container } = render(<TaxWaterfallChart result={result} title="t" />)
      const taxable = money(legendValue('Social Security — taxable'))
      const notTaxed = money(legendValue('Social Security — not taxed'))
      expect(taxable + notTaxed).toBe(money(legendValue('Social Security — gross')))
      const sum =
        money(legendValue('Ordinary income')) + money(legendValue('Preferential income')) + taxable + notTaxed
      const barTotal = result.grossOrdinaryIncome + result.grossPreferentialIncome + result.grossSocialSecurity
      expect(Math.abs(sum - barTotal)).toBeLessThanOrEqual(1)
      expect(money(legendValue('Total income including Social Security'))).toBe(Math.round(barTotal))
      const widths = Array.from(container.querySelectorAll('rect[class*="segmentSources"]')).map((r) =>
        Number(r.getAttribute('width')),
      )
      expect(widths).toHaveLength(4)
      expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(VIEW_WIDTH, 5)
    })
  }

  it('no-SS control draws no Social Security rows or sources bar', () => {
    const { container } = render(
      <TaxWaterfallChart result={computeFederalTax(STORY_FIXTURES.MiddleIncome)} title="t" />,
    )
    expect(screen.queryByText('Social Security — gross')).toBeNull()
    expect(container.querySelectorAll('rect[class*="segmentSources"]')).toHaveLength(0)
  })

  it('fractional inputs: rounds half-up, remainder uses rounded gross, SS rows sum exactly', () => {
    const base = computeFederalTax(SS_PARTIAL_TAXABLE)
    const result = {
      ...base,
      grossSocialSecurity: 20_000.6,
      grossOrdinaryIncome: 30_000.5,
      grossPreferentialIncome: 100.4,
    }
    const { container } = render(<TaxWaterfallChart result={result} title="t" />)
    const taxable = base.taxableSocialSecurity
    expect(legendValue('Social Security — gross')).toBe(formatCurrency(20_001))
    expect(legendValue('Social Security — taxable')).toBe(formatCurrency(taxable))
    expect(legendValue('Social Security — not taxed')).toBe(formatCurrency(Math.round(20_000.6) - taxable))
    expect(money(legendValue('Social Security — taxable')) + money(legendValue('Social Security — not taxed'))).toBe(
      money(legendValue('Social Security — gross')),
    )
    expect(legendValue('Ordinary income')).toBe(formatCurrency(30_001))
    expect(legendValue('Preferential income')).toBe(formatCurrency(100))
    // The drawn remainder is the same whole-dollar figure the legend shows (not the raw fraction).
    const widths = Array.from(container.querySelectorAll('rect[class*="segmentSources"]')).map((r) =>
      Number(r.getAttribute('width')),
    )
    const total = 30_001 + 100 + 20_001
    expect(widths[3]).toBeCloseTo(((20_001 - taxable) / total) * VIEW_WIDTH, 8)
  })

  it('draws the four segments in order, with proportional widths and per-row swatches (T6)', () => {
    const { container } = render(<TaxWaterfallChart result={computeFederalTax(SS_PARTIAL_TAXABLE)} title="t" />)
    const rects = Array.from(container.querySelectorAll('rect[class*="segmentSources"]'))
    const roles = ['Ordinary', 'Preferential', 'SsTaxable', 'SsNotTaxed']
    roles.forEach((role, i) => expect(rects[i].getAttribute('class')).toContain(`segmentSources${role}`))
    // Total 50,000: ordinary 30,000, preferential 0, taxable 9,600, not taxed 10,400.
    const widths = rects.map((r) => Number(r.getAttribute('width')))
    const expected = [30_000, 0, 9_600, 10_400].map((v) => (v / 50_000) * VIEW_WIDTH)
    widths.forEach((w, i) => expect(w).toBeCloseTo(expected[i], 5))
    const xs = rects.map((r) => Number(r.getAttribute('x')))
    expect(xs[2]).toBeCloseTo(expected[0] + expected[1], 5)
    expect(xs[3]).toBeCloseTo(expected[0] + expected[1] + expected[2], 5)

    const swatchClass = (label: string) =>
      screen.getByText(label).closest('tr')?.querySelector('span[aria-hidden="true"]')?.getAttribute('class') ?? ''
    expect(swatchClass('Ordinary income')).toContain('swatchOrdinary')
    expect(swatchClass('Preferential income')).toContain('swatchPreferential')
    expect(swatchClass('Social Security — taxable')).toContain('swatchSsTaxable')
    const notTaxed = swatchClass('Social Security — not taxed')
    expect(notTaxed).toContain('swatchSsNotTaxed')
    expect(notTaxed).not.toContain('swatchSsTaxable')
  })
})
