import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LeftNav } from './LeftNav'
import type { NavItem } from './LeftNav'

const items: NavItem[] = [
  { id: 'plan', label: 'Plan' },
  { id: 'calculators', label: 'Calculators' },
]

describe('LeftNav', () => {
  afterEach(() => cleanup())

  it('renders a nav landmark with an item per entry', () => {
    render(<LeftNav items={items} activeId="plan" onSelect={() => {}} />)
    expect(screen.getByRole('navigation')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Plan' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Calculators' })).toBeInTheDocument()
  })

  it('marks the active item with aria-current="page" and leaves the rest unmarked', () => {
    render(<LeftNav items={items} activeId="calculators" onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: 'Plan' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('button', { name: 'Calculators' })).toHaveAttribute('aria-current', 'page')
  })

  it('does not use role="tab" (this is a nav, not a tablist)', () => {
    render(<LeftNav items={items} activeId="plan" onSelect={() => {}} />)
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  it('calls onSelect with the clicked item id', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<LeftNav items={items} activeId="plan" onSelect={onSelect} />)
    await user.click(screen.getByRole('button', { name: 'Calculators' }))
    expect(onSelect).toHaveBeenCalledWith('calculators')
  })

  it('only the active item is in the tab order (roving tabindex)', () => {
    render(<LeftNav items={items} activeId="plan" onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: 'Plan' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('button', { name: 'Calculators' })).toHaveAttribute('tabindex', '-1')
  })

  it('moves focus to the next item on ArrowDown, wrapping at the end', async () => {
    const user = userEvent.setup()
    render(<LeftNav items={items} activeId="plan" onSelect={() => {}} />)
    const plan = screen.getByRole('button', { name: 'Plan' })
    const calculators = screen.getByRole('button', { name: 'Calculators' })
    plan.focus()
    await user.keyboard('{ArrowDown}')
    expect(calculators).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(plan).toHaveFocus()
  })

  it('moves focus to the previous item on ArrowUp, wrapping at the start', async () => {
    const user = userEvent.setup()
    render(<LeftNav items={items} activeId="plan" onSelect={() => {}} />)
    const plan = screen.getByRole('button', { name: 'Plan' })
    const calculators = screen.getByRole('button', { name: 'Calculators' })
    plan.focus()
    await user.keyboard('{ArrowUp}')
    expect(calculators).toHaveFocus()
  })

  it('moves focus to the first item on Home and the last item on End', async () => {
    const user = userEvent.setup()
    const threeItems: NavItem[] = [...items, { id: 'settings', label: 'Settings' }]
    render(<LeftNav items={threeItems} activeId="plan" onSelect={() => {}} />)
    const plan = screen.getByRole('button', { name: 'Plan' })
    const settings = screen.getByRole('button', { name: 'Settings' })
    plan.focus()
    await user.keyboard('{End}')
    expect(settings).toHaveFocus()
    await user.keyboard('{Home}')
    expect(plan).toHaveFocus()
  })

  it('selects the focused item on Enter, via the keydown handler', () => {
    const onSelect = vi.fn()
    render(<LeftNav items={items} activeId="plan" onSelect={onSelect} />)
    const calculators = screen.getByRole('button', { name: 'Calculators' })
    calculators.focus()
    const event = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    fireEvent(calculators, event)
    expect(onSelect).toHaveBeenCalledWith('calculators')
  })

  it('selects the focused item on Space, via the keydown handler', () => {
    const onSelect = vi.fn()
    render(<LeftNav items={items} activeId="plan" onSelect={onSelect} />)
    const calculators = screen.getByRole('button', { name: 'Calculators' })
    calculators.focus()
    const event = new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    fireEvent(calculators, event)
    expect(onSelect).toHaveBeenCalledWith('calculators')
  })
})
