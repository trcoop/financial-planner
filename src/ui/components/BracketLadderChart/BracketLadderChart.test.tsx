import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { computeFederalTax } from '../../../engine'
import { STORY_FIXTURES } from '../../../engine/tax'
import type { FederalTaxResult } from '../../../engine'
import { formatCurrency, formatPercent } from '../../utils/format'
import { BracketLadderChart } from './BracketLadderChart'

const middleIncome = computeFederalTax(STORY_FIXTURES.MiddleIncome)
const topBracket = computeFederalTax(STORY_FIXTURES.TopBracket)
const preferentialHeavy = computeFederalTax(STORY_FIXTURES.PreferentialHeavy)
const zeroTax = computeFederalTax(STORY_FIXTURES.ZeroTax)
const seniorPhaseOut = computeFederalTax(STORY_FIXTURES.SeniorBonusPhaseOut)

type Rendered = ReturnType<typeof render>['container']
const fills = (c: Rendered, stack = 'ordinary') =>
  Array.from(c.querySelectorAll(`[data-stack="${stack}"] [data-role="band-fill"]`))
const widths = (c: Rendered, stack = 'ordinary') => fills(c, stack).map((f) => Number(f.getAttribute('width')))
const VIEW_WIDTH = 300

/** Overrides one ordinary band's income (fixtures never exceed a band's width, so clamping needs a synthetic band). */
function withBand(index: number, patch: Partial<FederalTaxResult['ordinaryBrackets'][number]>): FederalTaxResult {
  return {
    ...middleIncome,
    ordinaryBrackets: middleIncome.ordinaryBrackets.map((b, i) => (i === index ? { ...b, ...patch } : b)),
  }
}

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
    expect(
      screen.getAllByText(formatPercent(firstBand.rate * 100), { exact: false }).length,
    ).toBeGreaterThan(0)
  })

  it('gives the open-ended top band a synthetic-extent, open-ended label rather than scaling to Infinity', () => {
    render(<BracketLadderChart result={topBracket} title="Ladder" />)
    const topBand = topBracket.ordinaryBrackets[topBracket.ordinaryBrackets.length - 1]
    expect(topBand.upperBound).toBe(Infinity)
    expect(screen.getAllByText(/and up/i).length).toBeGreaterThan(0)
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

  it('sizes fills as income / (upperBound - lowerBound) of the viewBox, and fills a full band completely', () => {
    const { container } = render(<BracketLadderChart result={middleIncome} title="Ladder" />)
    const w = widths(container)
    const b = middleIncome.ordinaryBrackets
    expect(w[0]).toBe(VIEW_WIDTH)
    expect(w[1]).toBe(VIEW_WIDTH)
    expect(w[2]).toBeCloseTo((b[2].incomeInThisBracket / (b[2].upperBound - b[2].lowerBound)) * VIEW_WIDTH, 6)
    expect(w[2]).toBeGreaterThan(0)
    expect(w[2]).toBeLessThan(VIEW_WIDTH)
    expect(w.slice(3)).toEqual([0, 0, 0, 0])
  })

  it('clamps over-full bands to the track width and negative income to zero', () => {
    const over = render(<BracketLadderChart result={withBand(0, { incomeInThisBracket: 12_400 * 2 })} title="Ladder" />)
    expect(widths(over.container)[0]).toBe(VIEW_WIDTH)
    cleanup()
    const neg = render(<BracketLadderChart result={withBand(0, { incomeInThisBracket: -5 })} title="Ladder" />)
    expect(widths(neg.container)[0]).toBe(0)
  })

  it('treats a zero-width band as empty and the open-ended top band as fully filled only when occupied', () => {
    const { container } = render(<BracketLadderChart result={topBracket} title="Ladder" />)
    const w = widths(container)
    expect(w[w.length - 1]).toBe(VIEW_WIDTH)
    cleanup()
    // PreferentialHeavy's second preferential band is partly filled; its top band is unoccupied.
    const pref = render(<BracketLadderChart result={preferentialHeavy} title="Ladder" showPreferential />)
    const pw = widths(pref.container, 'preferential')
    expect(pw[0]).toBe(VIEW_WIDTH)
    expect(pw[1]).toBeCloseTo((344_450 / (551_600 - 55_550)) * VIEW_WIDTH, 6)
    expect(pw[2]).toBe(0)
    cleanup()
    const zero = render(<BracketLadderChart result={middleIncome} title="Ladder" />)
    expect(widths(zero.container).at(-1)).toBe(0)
  })

  it('renders a zero-width band as a zero-width fill rather than NaN', () => {
    const { container } = render(<BracketLadderChart result={middleIncome} title="Ladder" showPreferential />)
    const pref = middleIncome.preferentialBrackets[0]
    expect(pref.upperBound - pref.lowerBound).toBe(0)
    expect(fills(container, 'preferential')[0].getAttribute('width')).toBe('0')
  })

  it('keeps unoccupied bands at full track height with zero-width fill', () => {
    const { container } = render(<BracketLadderChart result={middleIncome} title="Ladder" />)
    const tracks = Array.from(container.querySelectorAll('[data-role="band-track"]'))
    const f = fills(container)
    const trackHeights = tracks.map((t) => t.getAttribute('height'))
    expect(new Set(trackHeights).size).toBe(1)
    expect(Number(trackHeights[0])).toBeGreaterThan(0)
    expect(tracks.every((t) => t.getAttribute('width') === String(VIEW_WIDTH))).toBe(true)
    expect(f[5].getAttribute('width')).toBe('0')
    expect(f[5].getAttribute('height')).toBe(trackHeights[0])
  })

  it('puts the marker on the marginal band, not band 0, at the fill edge', () => {
    const { container } = render(<BracketLadderChart result={middleIncome} title="Ladder" />)
    const groups = Array.from(container.querySelectorAll('[data-stack="ordinary"] svg > g'))
    const markerIdx = groups.map((g) => g.querySelector('[data-role="marginal-marker"]') !== null)
    expect(markerIdx).toEqual([false, false, true, false, false, false, false])
    const line = container.querySelector('[data-role="marginal-marker"]')!
    expect(Number(line.getAttribute('x1'))).toBeCloseTo(widths(container)[2], 6)
    expect(line.getAttribute('x2')).toBe(line.getAttribute('x1'))
    expect(groups[2].querySelector('[data-role="marker-label"]')?.textContent).toBe('Marginal bracket')
    expect(groups[0].querySelector('[data-role="band-income-label"]')?.textContent).toBe(
      `${formatCurrency(12_400)} taxed here`,
    )
  })

  it('nudges an empty marginal band\'s marker off the left edge', () => {
    const { container } = render(<BracketLadderChart result={preferentialHeavy} title="Ladder" />)
    const line = container.querySelector('[data-stack="ordinary"] [data-role="marginal-marker"]')!
    expect(widths(container)[0]).toBe(0)
    expect(line.getAttribute('x1')).toBe('1.5')
  })

  it('colours ordinary fills and legend swatch with primary, preferential with the chart series token', () => {
    const { container } = render(<BracketLadderChart result={preferentialHeavy} title="Ladder" showPreferential />)
    expect(fills(container).every((f) => f.getAttribute('fill') === 'var(--color-primary)')).toBe(true)
    expect(fills(container, 'preferential').every((f) => f.getAttribute('fill') === 'var(--chart-series-preferential)')).toBe(true)
    const swatchOf = (text: RegExp) => screen.getByText(text).querySelector('span')!.style.background
    expect(swatchOf(/Ordinary income taxed/)).toBe('var(--color-primary)')
    expect(swatchOf(/Preferential \(capital gains\) income taxed/)).toBe('var(--chart-series-preferential)')
  })

  it('hides the svg from assistive tech, shows the title, and names each table by its visible heading', () => {
    const { container } = render(<BracketLadderChart result={preferentialHeavy} title="My title" showPreferential />)
    for (const svg of Array.from(container.querySelectorAll('svg'))) expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByText('My title')).toBeVisible()
    const tables = screen.getAllByRole('table')
    expect(tables).toHaveLength(2)
    const names = tables.map((t) => document.getElementById(t.getAttribute('aria-labelledby')!)?.textContent)
    expect(names).toEqual(['Ordinary income ladder', 'Preferential (capital gains) ladder'])
    expect(screen.getByRole('table', { name: 'Ordinary income ladder' })).toBe(tables[0])
  })

  it('renders table headers and per-band cell contents from the engine result', () => {
    render(<BracketLadderChart result={middleIncome} title="Ladder" />)
    const table = screen.getByRole('table', { name: 'Ordinary income ladder' })
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Rate',
      'Range',
      'Income in band',
      'Tax from band',
    ])
    const rows = Array.from(table.querySelectorAll('tbody tr'))
    expect(rows).toHaveLength(middleIncome.ordinaryBrackets.length)
    const cells = (r: Element) => Array.from(r.querySelectorAll('td')).map((td) => td.textContent)
    expect(cells(rows[2])).toEqual([
      formatPercent(22),
      `${formatCurrency(50_400)} – ${formatCurrency(105_700)}`,
      formatCurrency(53_500),
      formatCurrency(11_770),
    ])
    expect(cells(rows[6])[1]).toBe(`${formatCurrency(640_600)} and up`)
  })

  it('shows the effective marginal rate distinct from the statutory rate when they differ', () => {
    render(<BracketLadderChart result={seniorPhaseOut} title="Ladder" />)
    expect(seniorPhaseOut.ordinaryBracketRate).not.toBeCloseTo(seniorPhaseOut.effectiveMarginalRate, 3)
    const annotation = screen.getByText(/Marginal statutory rate/)
    const [statutory, effective] = Array.from(annotation.querySelectorAll('strong')).map((e) => e.textContent)
    expect(statutory).toBe(formatPercent(seniorPhaseOut.ordinaryBracketRate * 100))
    expect(effective).toBe(formatPercent(seniorPhaseOut.effectiveMarginalRate * 100))
    expect(statutory).not.toBe(effective)
  })

  it('never imports engine/tax/tables (ERD §8.4) — asserted against this component\'s own source file', () => {
    const dir = dirname(fileURLToPath(import.meta.url))
    const source = readFileSync(join(dir, 'BracketLadderChart.tsx'), 'utf8')
    expect(source).not.toMatch(/tables/)
    expect(source).not.toMatch(/TAX_TABLES/)
  })

  it('styles the marker neutral, tracks, swatches, gap, title and label scale with shared tokens', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'BracketLadderChart.module.css'), 'utf8')
    const rule = (sel: string) => css.match(new RegExp(`${sel.replace(/[.[\]']/g, '\\$&')}\\s*\\{([^}]*)\\}`))![1]
    expect(css).not.toContain('--color-warning')
    expect(css).not.toContain('--color-success')
    expect(rule('.marker')).toMatch(/stroke:\s*var\(--color-text\)/)
    expect(rule('.markerLabel')).toMatch(/fill:\s*var\(--color-text\)/)
    expect(rule(".swatch[data-variant='marker']")).toMatch(/var\(--color-text\)/)
    expect(rule('.track')).toMatch(/fill:\s*var\(--color-border-subtle\)/)
    expect(rule('.swatch')).toMatch(/width:\s*var\(--chart-swatch-size\)/)
    expect(rule('.figure')).toMatch(/gap:\s*var\(--space-4\)/)
    expect(rule('.title')).toMatch(/align-self:\s*flex-start/)
    expect(rule('.plot')).toMatch(/max-width:\s*var\(--chart-plot-max-width\)/)
  })

  it('defines the preferential series token distinct from success, and a plot cap that keeps labels near 1:1', () => {
    const theme = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../theme.css'), 'utf8')
    const tok = (n: string) => theme.match(new RegExp(`${n}:\\s*([^;]+);`))![1].trim()
    expect(tok('--chart-series-preferential')).toBe('#7c3aed')
    expect(tok('--chart-series-preferential')).not.toBe(tok('--color-success'))
    // viewBox is 300 wide: the cap bounds the scale, so 12px labels render at most ~14.4px.
    expect(tok('--chart-plot-max-width')).toBe('360px')
    expect(tok('--chart-label-font-size')).toBe('12px')
  })

  it('lays the plot and table side by side from 960px and stacks below', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'BracketLadderChart.module.css'), 'utf8')
    const media = css.match(/@media \(min-width: 960px\)\s*\{([\s\S]*?)\n\}/)![1]
    expect(media).toMatch(/\.stack\s*\{[^}]*display:\s*grid/)
    expect(media).toMatch(/grid-template-columns:\s*var\(--chart-plot-max-width\)\s+minmax\(0,\s*1fr\)/)
    expect(media).toMatch(/column-gap:\s*var\(--space-5\)/)
    expect(media).toMatch(/\.stackTitle\s*\{[^}]*grid-column:\s*1 \/ -1/)
    // Outside the media query the stack stays a single flex column.
    expect(css.replace(media, '')).toMatch(/\.stack\s*\{[^}]*flex-direction:\s*column/)
  })

  it('leaves clear space between each band label baseline and the band below', () => {
    const { container } = render(<BracketLadderChart result={middleIncome} title="Ladder" />)
    const label = container.querySelector('[data-role="band-label"]')!
    const track = container.querySelector('[data-role="band-track"]')!
    expect(Number(track.getAttribute('y')) - Number(label.getAttribute('y'))).toBe(6)
  })
})
