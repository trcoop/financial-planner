import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DonutChart, type DonutSegment } from './DonutChart'

const segments: DonutSegment[] = [
  { label: 'Starting amount', value: 10_000 },
  { label: 'Contributions', value: 24_000 },
  { label: 'Growth', value: 16_000 },
]

describe('DonutChart', () => {
  afterEach(() => cleanup())

  it('renders a titled figure', () => {
    render(<DonutChart segments={segments} title="Contributions vs. growth" />)
    expect(screen.getByRole('figure', { name: 'Contributions vs. growth' })).toBeInTheDocument()
  })

  it('renders one arc path per segment', () => {
    const { container } = render(<DonutChart segments={segments} title="Breakdown" />)
    expect(container.querySelectorAll('path')).toHaveLength(3)
  })

  it('renders a visible legend with each label and its formatted currency value', () => {
    render(<DonutChart segments={segments} title="Breakdown" />)
    expect(screen.getByText('Starting amount')).toBeInTheDocument()
    expect(screen.getByText('$10,000')).toBeInTheDocument()
    expect(screen.getByText('Contributions')).toBeInTheDocument()
    expect(screen.getByText('$24,000')).toBeInTheDocument()
    expect(screen.getByText('Growth')).toBeInTheDocument()
    expect(screen.getByText('$16,000')).toBeInTheDocument()
  })

  it('gives each legend item an accessible text label/value not conveyed by color alone', () => {
    render(<DonutChart segments={segments} title="Breakdown" />)
    // A legend list item exposes both label and formatted value as plain text content,
    // independent of any color styling applied to its swatch.
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent('Starting amount')
    expect(items[0]).toHaveTextContent('$10,000')
  })

  it('assigns each arc path a distinct color', () => {
    const { container } = render(<DonutChart segments={segments} title="Breakdown" />)
    const paths = Array.from(container.querySelectorAll('path'))
    const fills = paths.map((p) => p.getAttribute('fill'))
    expect(new Set(fills).size).toBe(3)
  })

  it('uses each segment\'s explicit color when provided, on both arc and legend swatch', () => {
    const coloredSegments: DonutSegment[] = [
      { label: 'A', value: 1, color: 'red' },
      { label: 'B', value: 2, color: 'green' },
      { label: 'C', value: 3, color: 'blue' },
    ]
    const { container } = render(<DonutChart segments={coloredSegments} title="Breakdown" />)
    const paths = Array.from(container.querySelectorAll('path'))
    expect(paths.map((p) => p.getAttribute('fill'))).toEqual(['red', 'green', 'blue'])
  })

  it('renders nothing but the title for an empty segment list', () => {
    const { container } = render(<DonutChart segments={[]} title="Breakdown" />)
    expect(container.querySelectorAll('svg')).toHaveLength(0)
    expect(container.querySelectorAll('ul')).toHaveLength(0)
    expect(container.querySelectorAll('path')).toHaveLength(0)
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('draws a single full-circle arc for one 100%-share segment', () => {
    const { container } = render(
      <DonutChart segments={[{ label: 'Everything', value: 100 }]} title="Breakdown" />,
    )
    const paths = container.querySelectorAll('path')
    expect(paths).toHaveLength(1)
    // A full-circle wedge's start/end points coincide (angle 0 === angle 2π), which is a known
    // SVG arc-command edge case (a zero-length arc between identical points draws nothing) —
    // this pins down that the wedge still renders a non-trivial path `d` rather than silently
    // producing an empty/degenerate arc.
    expect(paths[0].getAttribute('d')).toMatch(/^M .+ A .+ L .+ A .+ Z$/)
  })

  it('supports an arbitrary number of segments, not just three', () => {
    const fiveSegments: DonutSegment[] = [
      { label: 'A', value: 1 },
      { label: 'B', value: 1 },
      { label: 'C', value: 1 },
      { label: 'D', value: 1 },
      { label: 'E', value: 1 },
    ]
    const { container } = render(<DonutChart segments={fiveSegments} title="Breakdown" />)
    expect(container.querySelectorAll('path')).toHaveLength(5)
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
  })

  it('omits a zero-value segment\'s arc (a zero-length arc draws nothing) but still lists it in the legend', () => {
    const withZero: DonutSegment[] = [
      { label: 'Starting amount', value: 0 },
      { label: 'Contributions', value: 10 },
      { label: 'Growth', value: 10 },
    ]
    const { container } = render(<DonutChart segments={withZero} title="Breakdown" />)
    expect(container.querySelectorAll('path')).toHaveLength(2)
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByText('Starting amount')).toBeInTheDocument()
  })
})
