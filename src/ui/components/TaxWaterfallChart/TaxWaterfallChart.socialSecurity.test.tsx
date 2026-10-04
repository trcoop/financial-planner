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

  it('not-taxed remainder uses rounded gross so SS segments still sum exactly', () => {
    const result = { ...computeFederalTax(SS_PARTIAL_TAXABLE), grossSocialSecurity: 20_000.4 }
    render(<TaxWaterfallChart result={result} title="t" />)
    expect(legendValue('Social Security — not taxed')).toBe(formatCurrency(10_400))
  })
})
