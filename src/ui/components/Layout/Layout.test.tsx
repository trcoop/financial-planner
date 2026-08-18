// @ts-nocheck -- uses Node's fs to read source files for a cross-file breakpoint
// consistency check; @types/node isn't included in this browser-app's tsconfig.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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

describe('responsive breakpoint consistency (FIN-32)', () => {
  // Layout, TabBar, and Drawer each switch to their mobile layout via a separate
  // media query. Before FIN-32 these disagreed (900px / 959px / 960px), leaving an
  // untested 901-959px zone where the page was single-column (mobile Layout) but
  // TabBar and Drawer still behaved as if desktop. Assert all three agree on a
  // single 960px breakpoint, with no gap across the previously-inconsistent range.
  it('switches Layout and TabBar to mobile at the same width Drawer treats as desktop (960px)', () => {
    const dir = dirname(fileURLToPath(import.meta.url))
    const layoutCss = readFileSync(join(dir, 'Layout.module.css'), 'utf-8')
    const tabBarCss = readFileSync(join(dir, '../TabBar/TabBar.module.css'), 'utf-8')
    const drawerTsx = readFileSync(join(dir, '../Drawer/Drawer.tsx'), 'utf-8')

    const layoutMatch = layoutCss.match(/max-width:\s*(\d+)px/)
    const tabBarMatch = tabBarCss.match(/max-width:\s*(\d+)px/)
    const drawerMatch = drawerTsx.match(/min-width:\s*(\d+)px/)

    expect(layoutMatch, 'Layout.module.css should have a max-width media query').not.toBeNull()
    expect(tabBarMatch, 'TabBar.module.css should have a max-width media query').not.toBeNull()
    expect(drawerMatch, "Drawer.tsx's DESKTOP_QUERY should have a min-width media query").not.toBeNull()

    const layoutMobileMax = Number(layoutMatch![1])
    const tabBarMobileMax = Number(tabBarMatch![1])
    const drawerDesktopMin = Number(drawerMatch![1])

    expect(drawerDesktopMin).toBe(960)
    // The mobile max-width query must be exactly one pixel below the desktop
    // min-width query, so every width maps to exactly one regime with no gap.
    expect(layoutMobileMax).toBe(drawerDesktopMin - 1)
    expect(tabBarMobileMax).toBe(drawerDesktopMin - 1)

    // Pin the specific 901-959px zone that was previously inconsistent: every
    // width in it must be mobile for Layout and TabBar, and sub-desktop for Drawer.
    for (const width of [901, 930, 959]) {
      expect(width).toBeLessThanOrEqual(layoutMobileMax)
      expect(width).toBeLessThanOrEqual(tabBarMobileMax)
      expect(width).toBeLessThan(drawerDesktopMin)
    }
  })
})
