// This file reads sibling source files with Node's fs to check breakpoint
// consistency across components — see the describe block below. @types/node
// is available project-wide (see tsconfig.app.json's "types"), so the Node
// builtins below type-check normally.
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
  // Layout, TabBar, TopBar, StatTile, and Drawer each switch to their mobile/
  // compact layout via a separate media query. Before FIN-32 these disagreed
  // (Layout at 900px; TopBar and StatTile at 960px, which as a max-width
  // overlaps Drawer's min-width:960px desktop query at exactly 960px; TabBar
  // already correct at 959px), leaving an untested 901-959px zone where the
  // page was single-column (mobile Layout) but other components still
  // behaved as if desktop. Assert all four CSS breakpoints agree with
  // Drawer's canonical 960px, with no gap or overlap.
  it('switches Layout, TabBar, TopBar, and StatTile to mobile at the same width Drawer treats as desktop (960px)', () => {
    const dir = dirname(fileURLToPath(import.meta.url))
    const layoutCss = readFileSync(join(dir, 'Layout.module.css'), 'utf-8')
    const tabBarCss = readFileSync(join(dir, '../TabBar/TabBar.module.css'), 'utf-8')
    const topBarCss = readFileSync(join(dir, '../TopBar/TopBar.module.css'), 'utf-8')
    const statTileCss = readFileSync(join(dir, '../StatTile/StatTile.module.css'), 'utf-8')
    const drawerTsx = readFileSync(join(dir, '../Drawer/Drawer.tsx'), 'utf-8')

    const mobileMaxQueries = {
      Layout: layoutCss.match(/max-width:\s*(\d+)px/),
      TabBar: tabBarCss.match(/max-width:\s*(\d+)px/),
      TopBar: topBarCss.match(/max-width:\s*(\d+)px/),
      StatTile: statTileCss.match(/max-width:\s*(\d+)px/),
    }
    const drawerMatch = drawerTsx.match(/min-width:\s*(\d+)px/)
    expect(drawerMatch, "Drawer.tsx's DESKTOP_QUERY should have a min-width media query").not.toBeNull()
    const drawerDesktopMin = Number(drawerMatch![1])
    expect(drawerDesktopMin).toBe(960)

    for (const [name, match] of Object.entries(mobileMaxQueries)) {
      expect(match, `${name}'s stylesheet should have a max-width media query`).not.toBeNull()
      // The mobile max-width query must be exactly one pixel below the desktop
      // min-width query, so every width maps to exactly one regime with no gap.
      expect(Number(match![1]), `${name}'s max-width should be one below Drawer's min-width`).toBe(
        drawerDesktopMin - 1,
      )
    }

    // Pin the specific 901-959px zone that was previously inconsistent: every
    // width in it must be mobile in all four stylesheets, and sub-desktop for Drawer.
    for (const width of [901, 930, 959]) {
      for (const [name, match] of Object.entries(mobileMaxQueries)) {
        expect(width, `${name} should treat ${width}px as mobile`).toBeLessThanOrEqual(Number(match![1]))
      }
      expect(width).toBeLessThan(drawerDesktopMin)
    }
  })
})
