import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { StatTile } from './StatTile'

describe('StatTile', () => {
  afterEach(() => cleanup())

  it('renders the label and value', () => {
    render(<StatTile label="Current investment balance" value="$120,000" />)
    expect(screen.getByText('Current investment balance')).toBeInTheDocument()
    expect(screen.getByText('$120,000')).toBeInTheDocument()
  })

  it('exposes the tile as a labeled region for assistive tech', () => {
    render(<StatTile label="Chance of success" value="87%" />)
    const region = screen.getByRole('region', { name: 'Chance of success' })
    expect(region).toHaveTextContent('87%')
  })

  it('renders placeholder/secondary value text with distinct styling', () => {
    render(<StatTile label="Chance of success" value="Run a stress test to see this" isPlaceholder />)
    const value = screen.getByText('Run a stress test to see this')
    expect(value.className).toMatch(/placeholder/)
  })

  it('does not apply placeholder styling by default', () => {
    render(<StatTile label="Chance of success" value="87%" />)
    const value = screen.getByText('87%')
    expect(value.className).not.toMatch(/placeholder/)
  })

  it('renders the action element instead of the value when provided', () => {
    render(<StatTile label="Chance of success" value="87%" action={<button>Re-run stress test</button>} />)
    expect(screen.getByRole('button', { name: 'Re-run stress test' })).toBeInTheDocument()
    expect(screen.queryByText('87%')).not.toBeInTheDocument()
  })

  it('still exposes the tile as a labeled region when rendering an action', () => {
    render(<StatTile label="Chance of success" value="87%" action={<button>Re-run stress test</button>} />)
    const region = screen.getByRole('region', { name: 'Chance of success' })
    expect(region).toContainElement(screen.getByRole('button', { name: 'Re-run stress test' }))
  })
})
