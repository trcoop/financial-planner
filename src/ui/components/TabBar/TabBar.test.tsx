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

    it('reduces the pill gap so two short labels fit without horizontal scrolling', () => {
      const tabBarRule = ruleFor('tabBar')
      const gapMatch = tabBarRule.match(/gap:\s*var\(--space-(\d)\)/)
      expect(gapMatch).not.toBeNull()
      // --space-2 (8px) is the pre-fix value that caused overflow; the fix
      // must tighten this further.
      expect(Number(gapMatch?.[1])).toBeLessThan(2)
    })

    it('reduces per-pill horizontal padding so two short labels fit without horizontal scrolling', () => {
      const tabRule = ruleFor('tab')
      const paddingMatch = tabRule.match(/padding:\s*var\(--space-(\d)\) var\(--space-(\d)\)/)
      expect(paddingMatch).not.toBeNull()
      // --space-4 (16px) horizontal was the pre-fix value; the fix must
      // tighten the horizontal component.
      expect(Number(paddingMatch?.[2])).toBeLessThan(4)
    })

    it('gives the tab bar the same outer horizontal padding as page content (--space-4, matching TopBar)', () => {
      const tabBarRule = ruleFor('tabBar')
      const paddingMatch = tabBarRule.match(/padding:\s*var\(--space-\d\) var\(--space-(\d)\)/)
      expect(paddingMatch).not.toBeNull()
      expect(paddingMatch?.[1]).toBe('4')
    })
  })
})
