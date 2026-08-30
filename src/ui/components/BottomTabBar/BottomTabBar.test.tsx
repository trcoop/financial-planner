import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BottomTabBar } from './BottomTabBar'
import type { NavItem } from '../LeftNav/LeftNav'
import { ChartIcon } from '../icons/ChartIcon'
import { GridIcon } from '../icons/GridIcon'

const items: NavItem[] = [
  { id: 'plan', label: 'Plan', icon: ChartIcon },
  { id: 'calculators', label: 'Calculators', icon: GridIcon },
]

describe('BottomTabBar', () => {
  afterEach(() => cleanup())

  it('renders a nav landmark with an icon and label per entry', () => {
    render(<BottomTabBar items={items} activeId="plan" onSelect={() => {}} />)
    expect(screen.getByRole('navigation')).toBeInTheDocument()
    const plan = screen.getByRole('button', { name: 'Plan' })
    const calculators = screen.getByRole('button', { name: 'Calculators' })
    expect(plan).toBeInTheDocument()
    expect(calculators).toBeInTheDocument()
    expect(plan.querySelector('svg')).toBeInTheDocument()
    expect(calculators.querySelector('svg')).toBeInTheDocument()
  })

  it('marks the active item with aria-current="page" and leaves the rest unmarked', () => {
    render(<BottomTabBar items={items} activeId="calculators" onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: 'Plan' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('button', { name: 'Calculators' })).toHaveAttribute('aria-current', 'page')
  })

  it('applies the active-tab accent styling class only to the active item', () => {
    render(<BottomTabBar items={items} activeId="plan" onSelect={() => {}} />)
    const plan = screen.getByRole('button', { name: 'Plan' })
    const calculators = screen.getByRole('button', { name: 'Calculators' })
    expect(plan.className).toMatch(/itemActive/)
    expect(calculators.className).not.toMatch(/itemActive/)
  })

  it('does not use role="tab" (this is a nav, not a tablist)', () => {
    render(<BottomTabBar items={items} activeId="plan" onSelect={() => {}} />)
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  it('calls onSelect with the clicked item id', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<BottomTabBar items={items} activeId="plan" onSelect={onSelect} />)
    await user.click(screen.getByRole('button', { name: 'Calculators' }))
    expect(onSelect).toHaveBeenCalledWith('calculators')
  })

  it('only the active item is in the tab order (roving tabindex)', () => {
    render(<BottomTabBar items={items} activeId="plan" onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: 'Plan' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('button', { name: 'Calculators' })).toHaveAttribute('tabindex', '-1')
  })

  it('moves focus to the next item on ArrowRight, wrapping at the end', async () => {
    const user = userEvent.setup()
    render(<BottomTabBar items={items} activeId="plan" onSelect={() => {}} />)
    const plan = screen.getByRole('button', { name: 'Plan' })
    const calculators = screen.getByRole('button', { name: 'Calculators' })
    plan.focus()
    await user.keyboard('{ArrowRight}')
    expect(calculators).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(plan).toHaveFocus()
  })

  it('moves focus to the previous item on ArrowLeft, wrapping at the start', async () => {
    const user = userEvent.setup()
    render(<BottomTabBar items={items} activeId="plan" onSelect={() => {}} />)
    const plan = screen.getByRole('button', { name: 'Plan' })
    const calculators = screen.getByRole('button', { name: 'Calculators' })
    plan.focus()
    await user.keyboard('{ArrowLeft}')
    expect(calculators).toHaveFocus()
  })

  it('moves focus to the first item on Home and the last item on End', async () => {
    const user = userEvent.setup()
    const threeItems: NavItem[] = [...items, { id: 'settings', label: 'Settings', icon: GridIcon }]
    render(<BottomTabBar items={threeItems} activeId="plan" onSelect={() => {}} />)
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
    render(<BottomTabBar items={items} activeId="plan" onSelect={onSelect} />)
    const calculators = screen.getByRole('button', { name: 'Calculators' })
    calculators.focus()
    const event = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    fireEvent(calculators, event)
    expect(onSelect).toHaveBeenCalledWith('calculators')
  })

  it('selects the focused item on Space, via the keydown handler', () => {
    const onSelect = vi.fn()
    render(<BottomTabBar items={items} activeId="plan" onSelect={onSelect} />)
    const calculators = screen.getByRole('button', { name: 'Calculators' })
    calculators.focus()
    const event = new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    fireEvent(calculators, event)
    expect(onSelect).toHaveBeenCalledWith('calculators')
  })
})
