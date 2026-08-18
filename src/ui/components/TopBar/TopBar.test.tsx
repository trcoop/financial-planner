import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TopBar } from './TopBar'

describe('TopBar', () => {
  afterEach(() => cleanup())

  it('renders a banner landmark', () => {
    render(<TopBar />)
    expect(screen.getByRole('banner')).toBeInTheDocument()
  })

  it('renders the app name', () => {
    render(<TopBar />)
    expect(screen.getByText('Financial Planner')).toBeInTheDocument()
  })

  it('renders a logo mark with accessible hidden decoration', () => {
    render(<TopBar />)
    const banner = screen.getByRole('banner')
    const logo = banner.querySelector('[aria-hidden="true"]')
    expect(logo).not.toBeNull()
  })

  it('exposes the app name as an accessible heading-like label on the banner', () => {
    render(<TopBar />)
    const banner = screen.getByRole('banner')
    expect(banner).toHaveTextContent('Financial Planner')
  })
})
