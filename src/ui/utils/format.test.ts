import { describe, expect, it } from 'vitest'
import { formatCurrency, formatPercent } from './format'

describe('formatCurrency', () => {
  it('formats a whole-dollar amount with thousands separators and no cents', () => {
    expect(formatCurrency(250000)).toBe('$250,000')
  })

  it('formats zero', () => {
    expect(formatCurrency(0)).toBe('$0')
  })

  it('rounds to the nearest dollar', () => {
    expect(formatCurrency(1249.6)).toBe('$1,250')
  })
})

describe('formatPercent', () => {
  it('formats a whole-number percentage', () => {
    expect(formatPercent(15)).toBe('15%')
  })

  it('formats a percentage with one decimal place', () => {
    expect(formatPercent(4.5)).toBe('4.5%')
  })

  it('formats zero', () => {
    expect(formatPercent(0)).toBe('0%')
  })
})
