import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Layout } from './Layout'

describe('Layout', () => {
  afterEach(() => cleanup())

  it('renders the form content in a labeled region', () => {
    render(<Layout form={<p>Form content</p>} results={<p>Results content</p>} />)
    const formRegion = screen.getByRole('region', { name: 'Plan inputs' })
    expect(formRegion).toHaveTextContent('Form content')
  })

  it('renders the results content in a labeled region', () => {
    render(<Layout form={<p>Form content</p>} results={<p>Results content</p>} />)
    const resultsRegion = screen.getByRole('region', { name: 'Projection results' })
    expect(resultsRegion).toHaveTextContent('Results content')
  })
})
