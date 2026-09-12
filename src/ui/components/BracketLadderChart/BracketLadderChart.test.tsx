import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { computeFederalTax } from '../../../engine'
import { STORY_FIXTURES } from '../../../engine/tax'
import { formatPercent } from '../../utils/format'
import { BracketLadderChart } from './BracketLadderChart'

const middleIncome = computeFederalTax(STORY_FIXTURES.MiddleIncome)
const topBracket = computeFederalTax(STORY_FIXTURES.TopBracket)
const preferentialHeavy = computeFederalTax(STORY_FIXTURES.PreferentialHeavy)
const zeroTax = computeFederalTax(STORY_FIXTURES.ZeroTax)

describe('BracketLadderChart', () => {
  afterEach(() => cleanup())

  it('renders a titled figure with an accessible name from title', () => {
    render(<BracketLadderChart result={middleIncome} title="Middle income, single filer" />)
    expect(screen.getByRole('figure', { name: 'Middle income, single filer' })).toBeInTheDocument()
  })

  it('renders one band row per ordinary bracket, including unoccupied ones', () => {
    const { container } = render(<BracketLadderChart result={middleIncome} title="Ladder" />)
    // Track rects (one per band) live in a dedicated group so they can be counted independently
    // of the fill rects.
    const tracks = container.querySelectorAll('[data-role="band-track"]')
    expect(tracks).toHaveLength(middleIncome.ordinaryBrackets.length)
    // MiddleIncome spans several ordinary brackets but not the top one — the top band must still
    // be present as a zero-fill row (ERD §8.3: unoccupied bands render at full height, zero fill).
    const topBandIndex = middleIncome.ordinaryBrackets.length - 1
    expect(middleIncome.ordinaryBrackets[topBandIndex].incomeInThisBracket).toBe(0)
    const fills = container.querySelectorAll('[data-role="band-fill"]')
    expect(fills[topBandIndex].getAttribute('width')).toBe('0')
  })

  it('renders a visible legend/table row for every band with rate, bounds, income and tax as text', () => {
    render(<BracketLadderChart result={middleIncome} title="Ladder" />)
    const rows = screen.getAllByRole('row')
    // header row + one row per ordinary band
    expect(rows.length).toBeGreaterThanOrEqual(middleIncome.ordinaryBrackets.length)
    // Spot check the first occupied band's numbers appear as plain text, not just as a fill width.
    const firstBand = middleIncome.ordinaryBrackets[0]
    expect(screen.getByText(formatPercent(firstBand.rate * 100), { exact: false })).toBeInTheDocument()
  })

  it('gives the open-ended top band a synthetic-extent, open-ended label rather than scaling to Infinity', () => {
    render(<BracketLadderChart result={topBracket} title="Ladder" />)
    const topBand = topBracket.ordinaryBrackets[topBracket.ordinaryBrackets.length - 1]
    expect(topBand.upperBound).toBe(Infinity)
    expect(screen.getByText(/and up/i)).toBeInTheDocument()
  })

  it('renders the marginal-band marker and the effectiveMarginalRate as a labelled annotation', () => {
    render(<BracketLadderChart result={middleIncome} title="Ladder" />)
    const marker = document.querySelector('[data-role="marginal-marker"]')
    expect(marker).not.toBeNull()
    expect(
      screen.getAllByText(formatPercent(middleIncome.effectiveMarginalRate * 100), { exact: false }).length,
    ).toBeGreaterThan(0)
  })

  it('does not render a preferential stack when showPreferential is omitted', () => {
    render(<BracketLadderChart result={preferentialHeavy} title="Ladder" />)
    expect(screen.queryByText(/preferential/i)).not.toBeInTheDocument()
  })

  it('renders a second preferential stack with its own legend when showPreferential is true', () => {
    render(<BracketLadderChart result={preferentialHeavy} title="Ladder" showPreferential />)
    expect(screen.getAllByText(/preferential/i).length).toBeGreaterThan(0)
    const tracks = document.querySelectorAll('[data-stack="preferential"] [data-role="band-track"]')
    expect(tracks.length).toBe(preferentialHeavy.preferentialBrackets?.length ?? 0)
  })

  it('handles a zero-tax scenario (every band unoccupied except the first) without throwing', () => {
    render(<BracketLadderChart result={zeroTax} title="Ladder" />)
    expect(screen.getByRole('figure', { name: 'Ladder' })).toBeInTheDocument()
  })

  it('never imports engine/tax/tables (ERD §8.4) — asserted against this component\'s own source file', () => {
    const dir = dirname(fileURLToPath(import.meta.url))
    const source = readFileSync(join(dir, 'BracketLadderChart.tsx'), 'utf8')
    expect(source).not.toMatch(/from ['"].*tables['"]/)
    expect(source).not.toMatch(/TAX_TABLES/)
  })
})
