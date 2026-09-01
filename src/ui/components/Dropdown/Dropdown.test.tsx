import { afterEach, describe, it, expect, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
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

  it('opens on Enter and moves focus into the listbox with the current option active', async () => {
    const user = userEvent.setup()
    setup()
    const trigger = screen.getByRole('button', { name: /Investment Calculator/ })
    trigger.focus()
    await user.keyboard('{Enter}')

    const listbox = screen.getByRole('listbox')
    expect(listbox).toHaveFocus()
    const options = within(listbox).getAllByRole('option')
    expect(listbox).toHaveAttribute('aria-activedescendant', options[0].id)
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
    expect(listbox).toHaveAttribute('aria-activedescendant', options[1].id)
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

  it('opens on ArrowDown with the current selection as the active option', async () => {
    const user = userEvent.setup()
    setup()
    const trigger = screen.getByRole('button', { name: /Investment Calculator/ })
    trigger.focus()
    await user.keyboard('{ArrowDown}')
    const listbox = screen.getByRole('listbox')
    const options = within(listbox).getAllByRole('option')
    expect(listbox).toHaveAttribute('aria-activedescendant', options[0].id)
  })

  it('moves the active option with ArrowDown/ArrowUp (roving focus)', async () => {
    const user = userEvent.setup()
    setup()
    const trigger = screen.getByRole('button', { name: /Investment Calculator/ })
    trigger.focus()
    await user.keyboard('{Enter}')
    const listbox = screen.getByRole('listbox')
    const options = within(listbox).getAllByRole('option')

    await user.keyboard('{ArrowDown}')
    expect(listbox).toHaveAttribute('aria-activedescendant', options[1].id)

    await user.keyboard('{ArrowDown}')
    expect(listbox).toHaveAttribute('aria-activedescendant', options[2].id)

    // stays at the last option
    await user.keyboard('{ArrowDown}')
    expect(listbox).toHaveAttribute('aria-activedescendant', options[2].id)

    await user.keyboard('{ArrowUp}')
    expect(listbox).toHaveAttribute('aria-activedescendant', options[1].id)
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
    expect(listbox).toHaveAttribute('aria-activedescendant', options[2].id)

    await user.keyboard('{Home}')
    expect(listbox).toHaveAttribute('aria-activedescendant', options[0].id)
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
})
