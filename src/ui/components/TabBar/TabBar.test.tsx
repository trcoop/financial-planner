import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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

  it('removes all tabs from the page tab order', () => {
    render(<TabBar tabs={tabs} activeTab="projection" onTabChange={() => {}} />)
    expect(screen.getByRole('tab', { name: 'Projection' })).toHaveAttribute('tabindex', '-1')
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

  it('defaults the tablist label to "Views"', () => {
    render(<TabBar tabs={tabs} activeTab="projection" onTabChange={() => {}} />)
    expect(screen.getByRole('tablist', { name: 'Views' })).toBeInTheDocument()
  })

  it('accepts a custom ariaLabel (FIN-115: reuse as the mobile Profile strip)', () => {
    render(<TabBar tabs={tabs} activeTab="projection" onTabChange={() => {}} ariaLabel="Profile sections" />)
    expect(screen.getByRole('tablist', { name: 'Profile sections' })).toBeInTheDocument()
    expect(screen.queryByRole('tablist', { name: 'Views' })).not.toBeInTheDocument()
  })

  // jsdom (this project's Vitest environment) doesn't load real stylesheets
  // or evaluate `@media` — `vite.config.ts` test config has no `css: true`,
  // so CSS module imports resolve to identity proxies and getComputedStyle
  // on rendered nodes returns nothing useful. These fixes are pure CSS, so
  // rather than a no-op assertion against jsdom, the tests below read the
  // actual mobile `@media (max-width: 959px)` block out of the CSS module
  // source and assert on the declarations that determine overflow/margin —
  // they fail if the gap/padding regress to values that would overflow
  // 375-430px viewports, or if the outer padding drifts from the 16px
  // (--space-4) used by TopBar/content.
  describe('mobile layout (< 960px), via TabBar.module.css source', () => {
    // Built with string replacement, not `new URL(relative, import.meta.url)`
    // — jsdom (this project's Vitest test environment) globally replaces
    // `URL` with its own implementation, which resolves relative URLs
    // against `window.location` (http://localhost:3000) rather than the
    // `file:` base passed in, silently producing the wrong path.
    const cssPath = fileURLToPath(import.meta.url).replace(/TabBar\.test\.tsx$/, 'TabBar.module.css')
    const css = readFileSync(cssPath, 'utf-8')
    const mobileBlockMatch = css.match(/@media \(max-width: 959px\) \{([\s\S]*)\}\s*$/)
    const mobileBlock = mobileBlockMatch?.[1] ?? ''

    function ruleFor(selector: string) {
      const match = mobileBlock.match(new RegExp(`\\.${selector} \\{([\\s\\S]*?)\\}`))
      return match?.[1] ?? ''
    }

    it('has a mobile @media block to inspect (sanity check for the regexes below)', () => {
      expect(mobileBlock.length).toBeGreaterThan(0)
    })

    // Direction B (FIN-90 round 4): once the pill background was dropped (round 3), the tight
    // --space-1 gap that used to prevent overflow made adjacent tabs read as one continuous
    // string of text with no visual separation between them. The gap needs to be wide enough
    // for each tab to read as distinct, while still relying on `.tabBar`'s own
    // `overflow-x: auto` (FIN-89) — not an ever-tighter gap — if tabs ever don't fit.
    it('gives tabs enough gap to read as visually distinct once the pill background is gone', () => {
      const tabBarRule = ruleFor('tabBar')
      const gapMatch = tabBarRule.match(/gap:\s*var\(--space-(\d)\)/)
      expect(gapMatch).not.toBeNull()
      // --space-1 (4px) was the round-3 value that read as scrunched together; require more.
      expect(Number(gapMatch?.[1])).toBeGreaterThan(1)
    })

    it('keeps horizontal scroll available as the overflow fallback (FIN-89) rather than relying on a tight gap', () => {
      expect(css).toMatch(/overflow-x:\s*auto;/)
    })

    // Direction B (FIN-90 round 3) dropped the mobile-only pill treatment entirely — mobile
    // now reuses the exact same underline `.tab` rule as desktop (no mobile-block override),
    // with zero horizontal padding on the tab itself (in the base rule read below rather than
    // the mobile block) so labels get the most room possible. FIN-110 (visual-review
    // follow-up, round 2) split the vertical value into asymmetric top/bottom (top pinned to a
    // literal `1.5px` to genuinely match the Calculators picker's label offset, rather than a
    // --space-* token — see the `.tab` rule's own comment for why), so the shape is now
    // `<top> 0 <bottom> 0` rather than a two-value shorthand; the left/right values (both 0)
    // are what this test actually cares about.
    it('gives tabs no horizontal padding of their own, so two short labels fit without horizontal scrolling', () => {
      // The base `.tab` rule (not `.tabBar`/`.tabActive`) is the first `.tab { ... }` block in
      // the file, and it precedes every @media block — this file has no mobile-specific `.tab`
      // override any more (mobile reuses the base rule as-is).
      const baseTabMatch = css.match(/\n\.tab \{([\s\S]*?)\n\}/)
      const baseTabRule = baseTabMatch?.[1] ?? ''
      expect(baseTabRule).toMatch(/padding:\s*1\.5px\s+0\s+var\(--space-\d\)\s+0\s*;/)
    })

    // FIN-110 (visual-review follow-up, round 2): padding-top alone can no longer carry the
    // tab's touch-target sizing — it's pinned to a near-zero literal px value so the label text
    // lines up with the Calculators picker's label (see the `.tab` rule's own comment). Touch-
    // target height (44px, the common a11y minimum) is carried by `min-height` instead, with
    // `align-items: flex-start` so that extra height doesn't re-center (and thus shift) the text.
    it('preserves a 44px touch target via min-height now that padding-top is pinned to a near-zero value for text alignment', () => {
      const baseTabMatch = css.match(/\n\.tab \{([\s\S]*?)\n\}/)
      const baseTabRule = baseTabMatch?.[1] ?? ''
      expect(baseTabRule).toMatch(/min-height:\s*44px\s*;/)
      expect(baseTabRule).toMatch(/align-items:\s*flex-start\s*;/)
    })

    it('gives the tab bar the same outer horizontal padding as page content (--space-4, matching TopBar)', () => {
      const tabBarRule = ruleFor('tabBar')
      const paddingMatch = tabBarRule.match(/padding:\s*var\(--space-\d\) var\(--space-(\d)\)/)
      expect(paddingMatch).not.toBeNull()
      expect(paddingMatch?.[1]).toBe('4')
    })
  })
})
