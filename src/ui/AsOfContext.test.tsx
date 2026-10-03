import { describe, expect, it, vi, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { AsOfProvider, FrozenAsOfProvider } from './AsOfContext'
import { useAsOf } from './useAsOf'
import { systemAsOf } from '../asOf'

function Show() {
  const asOf = useAsOf()
  return <span data-testid="v">{`${asOf.year}-${asOf.month}`}</span>
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('AsOfContext', () => {
  it('FrozenAsOfProvider supplies a constant asOf', () => {
    render(
      <FrozenAsOfProvider asOf={{ year: 2026, month: 9 }}>
        <Show />
      </FrozenAsOfProvider>,
    )
    expect(screen.getByTestId('v').textContent).toBe('2026-9')
  })

  it('AsOfProvider reads the clock once and keeps the value across re-renders', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2027, 2, 15))
    const { rerender } = render(
      <AsOfProvider>
        <Show />
      </AsOfProvider>,
    )
    expect(screen.getByTestId('v').textContent).toBe('2027-3')
    vi.setSystemTime(new Date(2030, 10, 1))
    rerender(
      <AsOfProvider>
        <Show />
      </AsOfProvider>,
    )
    expect(screen.getByTestId('v').textContent).toBe('2027-3')
  })

  it('useAsOf without a provider falls back to the page-load system asOf', () => {
    render(<Show />)
    const now = systemAsOf()
    expect(screen.getByTestId('v').textContent).toBe(`${now.year}-${now.month}`)
  })
})
