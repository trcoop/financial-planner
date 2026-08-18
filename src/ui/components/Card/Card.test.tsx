import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Card } from './Card'

describe('Card', () => {
  afterEach(() => cleanup())

  it('renders its children', () => {
    render(<Card>Card content</Card>)
    expect(screen.getByText('Card content')).toBeInTheDocument()
  })

  it('applies the default padding variant class', () => {
    render(<Card>Content</Card>)
    const card = screen.getByText('Content')
    expect(card.className).toMatch(/paddingDefault/)
  })

  it('applies the compact padding variant class when requested', () => {
    render(<Card padding="compact">Content</Card>)
    const card = screen.getByText('Content')
    expect(card.className).toMatch(/paddingCompact/)
    expect(card.className).not.toMatch(/paddingDefault/)
  })

  it('accepts an aria-label for use as a landmark', () => {
    render(<Card aria-label="Example card">Content</Card>)
    expect(screen.getByLabelText('Example card')).toBeInTheDocument()
  })
})
