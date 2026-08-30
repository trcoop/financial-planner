import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { CalculatorsSection } from './CalculatorsSection'

describe('CalculatorsSection', () => {
  afterEach(() => cleanup())

  it('renders the placeholder message', () => {
    render(<CalculatorsSection />)

    expect(screen.getByText(/no calculators yet/i)).toBeInTheDocument()
  })

  it('focuses the heading on mount', () => {
    render(<CalculatorsSection />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus()
  })
})
