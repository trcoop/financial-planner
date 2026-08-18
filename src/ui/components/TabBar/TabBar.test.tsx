import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TabBar } from './TabBar'

const tabs = [
  { id: 'projection', label: 'Projection' },
  { id: 'stress-test', label: 'Stress Test' },
]

describe('TabBar', () => {
  afterEach(() => cleanup())

  it('renders a tablist with a tab per entry', () => {
    render(<TabBar tabs={tabs} activeTab="projection" onTabChange={() => {}} />)
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Projection' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Stress Test' })).toBeInTheDocument()
  })

  it('marks the active tab as aria-selected and the rest as not selected', () => {
    render(<TabBar tabs={tabs} activeTab="stress-test" onTabChange={() => {}} />)
    expect(screen.getByRole('tab', { name: 'Projection' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: 'Stress Test' })).toHaveAttribute('aria-selected', 'true')
  })

  it('calls onTabChange with the clicked tab id', async () => {
    const user = userEvent.setup()
    const onTabChange = vi.fn()
    render(<TabBar tabs={tabs} activeTab="projection" onTabChange={onTabChange} />)
    await user.click(screen.getByRole('tab', { name: 'Stress Test' }))
    expect(onTabChange).toHaveBeenCalledWith('stress-test')
  })

  it('only the active tab is in the tab order (roving tabindex)', () => {
    render(<TabBar tabs={tabs} activeTab="projection" onTabChange={() => {}} />)
    expect(screen.getByRole('tab', { name: 'Projection' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('tab', { name: 'Stress Test' })).toHaveAttribute('tabindex', '-1')
  })

  it('moves focus to the next tab on ArrowRight, wrapping at the end', async () => {
    const user = userEvent.setup()
    render(<TabBar tabs={tabs} activeTab="projection" onTabChange={() => {}} />)
    const projectionTab = screen.getByRole('tab', { name: 'Projection' })
    const stressTestTab = screen.getByRole('tab', { name: 'Stress Test' })
    projectionTab.focus()
    await user.keyboard('{ArrowRight}')
    expect(stressTestTab).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(projectionTab).toHaveFocus()
  })

  it('moves focus to the previous tab on ArrowLeft, wrapping at the start', async () => {
    const user = userEvent.setup()
    render(<TabBar tabs={tabs} activeTab="projection" onTabChange={() => {}} />)
    const projectionTab = screen.getByRole('tab', { name: 'Projection' })
    const stressTestTab = screen.getByRole('tab', { name: 'Stress Test' })
    projectionTab.focus()
    await user.keyboard('{ArrowLeft}')
    expect(stressTestTab).toHaveFocus()
  })

  it('selects the focused tab on Enter, via the keydown handler (not native click semantics)', async () => {
    const user = userEvent.setup()
    const onTabChange = vi.fn()
    render(<TabBar tabs={tabs} activeTab="projection" onTabChange={onTabChange} />)
    screen.getByRole('tab', { name: 'Projection' }).focus()
    await user.keyboard('{ArrowRight}')
    const stressTestTab = screen.getByRole('tab', { name: 'Stress Test' })
    // fireEvent dispatches only the keydown event, unlike userEvent which also
    // synthesizes a native click for Enter/Space on a <button> — this isolates
    // the component's own keydown handling from native button semantics.
    const event = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    fireEvent(stressTestTab, event)
    expect(onTabChange).toHaveBeenCalledWith('stress-test')
    expect(event.defaultPrevented).toBe(true)
  })

  it('selects the focused tab on Space, via the keydown handler (not native click semantics)', async () => {
    const user = userEvent.setup()
    const onTabChange = vi.fn()
    render(<TabBar tabs={tabs} activeTab="projection" onTabChange={onTabChange} />)
    screen.getByRole('tab', { name: 'Projection' }).focus()
    await user.keyboard('{ArrowRight}')
    const stressTestTab = screen.getByRole('tab', { name: 'Stress Test' })
    const event = new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    fireEvent(stressTestTab, event)
    expect(onTabChange).toHaveBeenCalledWith('stress-test')
    expect(event.defaultPrevented).toBe(true)
  })
})
