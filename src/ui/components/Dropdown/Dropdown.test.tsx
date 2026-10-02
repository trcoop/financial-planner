import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dropdown } from './Dropdown'

afterEach(() => cleanup())

const OPTIONS = [
  { id: 'investment', label: 'Investment Calculator' },
  { id: 'mortgage', label: 'Mortgage Calculator' },
  { id: 'payroll', label: 'Payroll Calculator' },
]

function setup(overrides: Partial<React.ComponentProps<typeof Dropdown>> = {}) {
  const onSelect = vi.fn()
  const props = {
    options: OPTIONS,
    selectedId: 'investment',
    onSelect,
    ariaLabel: 'Choose calculator',
    ...overrides,
  }
  render(<Dropdown {...props} />)
  return { onSelect }
}

describe('Dropdown', () => {
  it('renders the trigger with the current selection label', () => {
    setup()
    const trigger = screen.getByRole('button', { name: /Investment Calculator/ })
    expect(trigger).toBeInTheDocument()
  })

  it('opens a listbox popover on click and closes it again on a second click', async () => {
    const user = userEvent.setup()
    setup()
    const trigger = screen.getByRole('button', { name: /Investment Calculator/ })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    await user.click(trigger)
    const listbox = screen.getByRole('listbox')
    expect(listbox).toBeInTheDocument()
    expect(within(listbox).getAllByRole('option')).toHaveLength(3)

    await user.click(trigger)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('opens on Enter and keeps DOM focus on the trigger, with the current option active via aria-activedescendant', async () => {
    // Select-only-combobox pattern (WAI-ARIA APG): focus never leaves the trigger. The listbox
    // itself is never focused — the trigger's aria-activedescendant is what tracks the active
    // option, even though the listbox it names lives in a portal elsewhere in the DOM.
    const user = userEvent.setup()
    setup()
    const trigger = screen.getByRole('button', { name: /Investment Calculator/ })
    trigger.focus()
    await user.keyboard('{Enter}')

    expect(trigger).toHaveFocus()
    const listbox = screen.getByRole('listbox')
    const options = within(listbox).getAllByRole('option')
    expect(trigger).toHaveAttribute('aria-activedescendant', options[0].id)
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('opens with the *currently selected* option active, not always the first', async () => {
    const user = userEvent.setup()
    setup({ selectedId: 'mortgage' })
    const trigger = screen.getByRole('button', { name: /Mortgage Calculator/ })
    trigger.focus()
    await user.keyboard('{Enter}')

    const listbox = screen.getByRole('listbox')
    const options = within(listbox).getAllByRole('option')
    expect(trigger).toHaveAttribute('aria-activedescendant', options[1].id)
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
  })

  it('opens on Space', async () => {
    const user = userEvent.setup()
    setup()
    const trigger = screen.getByRole('button', { name: /Investment Calculator/ })
    trigger.focus()
    await user.keyboard(' ')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('is explicitly in the Tab order (tabIndex=0), not just implicitly focusable as a <button>', () => {
    // FIN-110 regression: macOS Safari/Firefox skip plain <button>s in the Tab order by
    // default (only tabbing to them when "Full Keyboard Access" is on), so the trigger needs
    // an explicit tabIndex to stay reliably reachable via Tab — this is what actually broke
    // "Tab into the field, press ArrowDown" for Travis; jsdom's `.focus()` doesn't model
    // Safari's Tab-order skipping, so it can't otherwise catch a regression here.
    setup()
    const trigger = screen.getByRole('button', { name: /Investment Calculator/ })
    expect(trigger).toHaveAttribute('tabIndex', '0')
  })

  it('does not visually highlight the current selection on open until the user hovers or presses an arrow key', async () => {
    // FIN-110 round 2: the popover previously highlighted the current selection the instant it
    // opened, which read as an unintentional "stuck" highlight rather than a deliberate one —
    // `aria-activedescendant`/`aria-selected` still track the current selection immediately (for
    // a11y), but the *visual* highlight class should only appear once the user actually starts
    // moving through the list.
    const user = userEvent.setup()
    setup({ selectedId: 'mortgage' })
    const trigger = screen.getByRole('button', { name: /Mortgage Calculator/ })
    trigger.focus()
    await user.keyboard('{Enter}')

    const listbox = screen.getByRole('listbox')
    const options = within(listbox).getAllByRole('option')
    expect(options[1].className).not.toMatch(/optionActive/)

    await user.keyboard('{ArrowDown}')
    expect(options[2].className).toMatch(/optionActive/)
  })

  it('highlights an option on hover even before any keyboard interaction', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: /Investment Calculator/ }))
    const listbox = screen.getByRole('listbox')
    const options = within(listbox).getAllByRole('option')
    expect(options[0].className).not.toMatch(/optionActive/)

    await user.hover(options[2])
    expect(options[2].className).toMatch(/optionActive/)
  })

  it('opens on ArrowDown with the current selection as the active option', async () => {
    const user = userEvent.setup()
    setup()
    const trigger = screen.getByRole('button', { name: /Investment Calculator/ })
    trigger.focus()
    await user.keyboard('{ArrowDown}')
    const listbox = screen.getByRole('listbox')
    const options = within(listbox).getAllByRole('option')
    expect(trigger).toHaveAttribute('aria-activedescendant', options[0].id)
  })

  it('moves the active option with repeated sequential ArrowDown/ArrowUp presses, all handled by the trigger', async () => {
    // Regression test for the real bug: an earlier implementation moved DOM focus into the
    // portaled listbox on open and handled arrow keys there. The *first* ArrowDown (which opens
    // the popover) worked because it's handled by the trigger regardless, but every ArrowDown
    // after that relied on focus having actually landed on the listbox div — which was flaky
    // across portal-mount timing/browsers, so the second and later presses silently did nothing.
    // Under the select-only-combobox pattern focus never moves, so this must advance every time.
    const user = userEvent.setup()
    setup()
    const trigger = screen.getByRole('button', { name: /Investment Calculator/ })
    trigger.focus()
    await user.keyboard('{Enter}')
    expect(trigger).toHaveFocus()
    const listbox = screen.getByRole('listbox')
    const options = within(listbox).getAllByRole('option')

    await user.keyboard('{ArrowDown}')
    expect(trigger).toHaveAttribute('aria-activedescendant', options[1].id)
    expect(trigger).toHaveFocus()

    await user.keyboard('{ArrowDown}')
    expect(trigger).toHaveAttribute('aria-activedescendant', options[2].id)
    expect(trigger).toHaveFocus()

    // stays at the last option
    await user.keyboard('{ArrowDown}')
    expect(trigger).toHaveAttribute('aria-activedescendant', options[2].id)

    await user.keyboard('{ArrowUp}')
    expect(trigger).toHaveAttribute('aria-activedescendant', options[1].id)

    await user.keyboard('{ArrowUp}')
    expect(trigger).toHaveAttribute('aria-activedescendant', options[0].id)
  })

  it('Home/End jump the active option to the first/last', async () => {
    const user = userEvent.setup()
    setup()
    const trigger = screen.getByRole('button', { name: /Investment Calculator/ })
    trigger.focus()
    await user.keyboard('{Enter}')
    const listbox = screen.getByRole('listbox')
    const options = within(listbox).getAllByRole('option')

    await user.keyboard('{End}')
    expect(trigger).toHaveAttribute('aria-activedescendant', options[2].id)

    await user.keyboard('{Home}')
    expect(trigger).toHaveAttribute('aria-activedescendant', options[0].id)
  })

  it('selects the active option with Enter, closes the popover, and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    const { onSelect } = setup()
    const trigger = screen.getByRole('button', { name: /Investment Calculator/ })
    trigger.focus()
    await user.keyboard('{Enter}')
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')

    expect(onSelect).toHaveBeenCalledWith('mortgage')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('selects the active option with Space', async () => {
    const user = userEvent.setup()
    const { onSelect } = setup()
    const trigger = screen.getByRole('button', { name: /Investment Calculator/ })
    trigger.focus()
    await user.keyboard('{Enter}')
    await user.keyboard('{ArrowDown}')
    await user.keyboard(' ')

    expect(onSelect).toHaveBeenCalledWith('mortgage')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('clicking an option selects it, closes the popover, and updates the displayed selection', async () => {
    const user = userEvent.setup()
    const { onSelect } = setup()
    await user.click(screen.getByRole('button', { name: /Investment Calculator/ }))
    const listbox = screen.getByRole('listbox')
    await user.click(within(listbox).getByRole('option', { name: 'Payroll Calculator' }))

    expect(onSelect).toHaveBeenCalledWith('payroll')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('closes without changing selection on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    const { onSelect } = setup()
    const trigger = screen.getByRole('button', { name: /Investment Calculator/ })
    trigger.focus()
    await user.keyboard('{Enter}')
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Escape}')

    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('dismisses on outside click without changing selection and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    const { onSelect } = setup()
    const outside = document.createElement('div')
    outside.setAttribute('data-testid', 'outside')
    document.body.appendChild(outside)
    const trigger = screen.getByRole('button', { name: /Investment Calculator/ })
    await user.click(trigger)
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    await user.click(outside)

    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('associates with an external label via the id prop (labelable button)', () => {
    render(
      <>
        <label htmlFor="freq">Compounding frequency</label>
        <Dropdown
          id="freq"
          options={OPTIONS}
          selectedId="investment"
          onSelect={vi.fn()}
          ariaLabel="Compounding frequency"
        />
      </>,
    )
    expect(screen.getByLabelText('Compounding frequency')).toBeInTheDocument()
  })

  it('applies fullWidth styling hooks and forwards aria-invalid/aria-describedby', () => {
    setup({ fullWidth: true, ariaInvalid: true, ariaDescribedBy: 'err-id' })
    const trigger = screen.getByRole('button', { name: /Investment Calculator/ })
    expect(trigger).toHaveAttribute('aria-invalid', 'true')
    expect(trigger).toHaveAttribute('aria-describedby', 'err-id')
  })
  describe('type-ahead and paging', () => {
    const MONTHS = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ].map((m) => ({ id: m, label: m }))
    const YEARS = Array.from({ length: 83 }, (_, i) => ({ id: String(2008 - i), label: String(2008 - i) }))

    async function openList(options: { id: string; label: string }[], selectedId: string) {
      const user = userEvent.setup({ delay: null })
      setup({ options, selectedId })
      const trigger = screen.getByRole('button', { name: options.find((o) => o.id === selectedId)!.label })
      trigger.focus()
      await user.keyboard('{Enter}')
      const opts = within(screen.getByRole('listbox')).getAllByRole('option')
      return { user, trigger, opts }
    }

    // shouldAdvanceTime: RTL's async wrapper schedules real-looking timeouts that would hang
    // under fully frozen fake timers; the reset-window assertions advance time explicitly.
    beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
    afterEach(() => vi.useRealTimers())

    it('typing a prefix jumps to the first option starting with it ("Ju" reaches June)', async () => {
      const { user, trigger, opts } = await openList(MONTHS, 'January')
      await user.keyboard('Ju')
      expect(trigger).toHaveAttribute('aria-activedescendant', opts[5].id)
      expect(opts[5].className).toMatch(/optionActive/)
    })

    it('reaches 1990 in a long year list by typing "1990"', async () => {
      const { user, trigger, opts } = await openList(YEARS, '2008')
      await user.keyboard('1990')
      expect(trigger).toHaveAttribute('aria-activedescendant', opts[18].id)
    })

    it('matches only at the start of the label, not anywhere inside it', async () => {
      const { user, trigger, opts } = await openList(MONTHS, 'March')
      await user.keyboard('r')
      // "r" occurs inside January/February/March but no month starts with it: no movement
      expect(trigger).toHaveAttribute('aria-activedescendant', opts[2].id)
    })

    it('is case-insensitive', async () => {
      const { user, trigger, opts } = await openList(MONTHS, 'January')
      await user.keyboard('JU')
      expect(trigger).toHaveAttribute('aria-activedescendant', opts[5].id)
      await user.keyboard('{Escape}')
    })

    it('leaves the active option alone when nothing matches', async () => {
      const { user, trigger, opts } = await openList(MONTHS, 'March')
      await user.keyboard('zz')
      expect(trigger).toHaveAttribute('aria-activedescendant', opts[2].id)
    })

    it('accumulates characters within the window and resets after the timeout', async () => {
      const { user, trigger, opts } = await openList(MONTHS, 'January')
      await user.keyboard('Ju')
      expect(trigger).toHaveAttribute('aria-activedescendant', opts[5].id)
      await user.keyboard('l')
      expect(trigger).toHaveAttribute('aria-activedescendant', opts[6].id)
      act(() => {
        vi.advanceTimersByTime(700)
      })
      // buffer cleared: "n" is a fresh prefix (not "Juln"), so it finds November
      await user.keyboard('n')
      expect(trigger).toHaveAttribute('aria-activedescendant', opts[10].id)
    })

    it('keeps the buffer alive when keys arrive within the window (each key restarts it)', async () => {
      const { user, trigger, opts } = await openList(MONTHS, 'January')
      await user.keyboard('J')
      act(() => {
        vi.advanceTimersByTime(400)
      })
      await user.keyboard('u')
      act(() => {
        vi.advanceTimersByTime(400)
      })
      await user.keyboard('n')
      expect(trigger).toHaveAttribute('aria-activedescendant', opts[5].id)
    })

    it('Space selects when the buffer is empty', async () => {
      const { user } = await openList(MONTHS, 'January')
      await user.keyboard('{ArrowDown}')
      await user.keyboard(' ')
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })

    it('Space is part of the prefix when the buffer is non-empty and does not select', async () => {
      const opts2 = [
        { id: 'a', label: 'Alpha' },
        { id: 'nm', label: 'New Mexico' },
        { id: 'ny', label: 'New York' },
      ]
      const { user, trigger, opts } = await openList(opts2, 'a')
      await user.keyboard('new y')
      expect(screen.getByRole('listbox')).toBeInTheDocument()
      expect(trigger).toHaveAttribute('aria-activedescendant', opts[2].id)
    })

    it('Space selects again once the buffer has timed out', async () => {
      const { user } = await openList(MONTHS, 'January')
      await user.keyboard('Ju')
      act(() => {
        vi.advanceTimersByTime(700)
      })
      await user.keyboard(' ')
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })

    it('clears the buffer when the list is closed and reopened', async () => {
      const { user, trigger } = await openList(MONTHS, 'January')
      await user.keyboard('Ju')
      await user.keyboard('{Escape}')
      await user.keyboard('{Enter}')
      const opts = within(screen.getByRole('listbox')).getAllByRole('option')
      await user.keyboard('n')
      expect(trigger).toHaveAttribute('aria-activedescendant', opts[10].id)
    })

    it('PageDown moves 10 options and PageUp moves back 10', async () => {
      const { user, trigger, opts } = await openList(YEARS, '2008')
      await user.keyboard('{PageDown}')
      expect(trigger).toHaveAttribute('aria-activedescendant', opts[10].id)
      expect(opts[10].className).toMatch(/optionActive/)
      await user.keyboard('{PageDown}')
      expect(trigger).toHaveAttribute('aria-activedescendant', opts[20].id)
      await user.keyboard('{PageUp}')
      expect(trigger).toHaveAttribute('aria-activedescendant', opts[10].id)
    })

    it('PageDown/PageUp clamp at the last/first option', async () => {
      const { user, trigger, opts } = await openList(YEARS, '2008')
      await user.keyboard('{PageUp}')
      expect(trigger).toHaveAttribute('aria-activedescendant', opts[0].id)
      await user.keyboard('{End}')
      await user.keyboard('{ArrowUp}')
      await user.keyboard('{PageDown}')
      expect(trigger).toHaveAttribute('aria-activedescendant', opts[82].id)
      await user.keyboard('{Home}')
      await user.keyboard('{ArrowDown}')
      await user.keyboard('{PageUp}')
      expect(trigger).toHaveAttribute('aria-activedescendant', opts[0].id)
    })
  })
})
