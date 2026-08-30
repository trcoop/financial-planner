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
  // Layout, TabBar, TopBar, and StatTile each switch to their mobile/compact layout via a
  // separate media query. Before FIN-32 these disagreed (Layout at 900px; TopBar and StatTile
  // at 960px; TabBar already correct at 959px), leaving an untested 901-959px zone where the
  // page was single-column (mobile Layout) but other components still behaved as if desktop.
  // Assert all four CSS breakpoints agree on the app's single canonical 960px desktop
  // threshold, with no gap or overlap. (The threshold used to be sourced from the now-deleted
  // Drawer component's DESKTOP_QUERY — FIN-98 deleted Drawer, so this pins the raw constant
  // directly instead.)
  const DESKTOP_MIN_WIDTH = 960

  it('switches Layout, TabBar, TopBar, and StatTile to mobile at the app-wide desktop threshold (960px)', () => {
    const dir = dirname(fileURLToPath(import.meta.url))
    const layoutCss = readFileSync(join(dir, 'Layout.module.css'), 'utf-8')
    const tabBarCss = readFileSync(join(dir, '../TabBar/TabBar.module.css'), 'utf-8')
    const topBarCss = readFileSync(join(dir, '../TopBar/TopBar.module.css'), 'utf-8')
    const statTileCss = readFileSync(join(dir, '../StatTile/StatTile.module.css'), 'utf-8')

    const mobileMaxQueries = {
      Layout: layoutCss.match(/max-width:\s*(\d+)px/),
      TabBar: tabBarCss.match(/max-width:\s*(\d+)px/),
      TopBar: topBarCss.match(/max-width:\s*(\d+)px/),
      StatTile: statTileCss.match(/max-width:\s*(\d+)px/),
    }

    for (const [name, match] of Object.entries(mobileMaxQueries)) {
      expect(match, `${name}'s stylesheet should have a max-width media query`).not.toBeNull()
      // The mobile max-width query must be exactly one pixel below the desktop
      // min-width threshold, so every width maps to exactly one regime with no gap.
      expect(Number(match![1]), `${name}'s max-width should be one below the desktop threshold`).toBe(
        DESKTOP_MIN_WIDTH - 1,
      )
    }

    // Pin the specific 901-959px zone that was previously inconsistent: every
    // width in it must be mobile in all four stylesheets.
    for (const width of [901, 930, 959]) {
      for (const [name, match] of Object.entries(mobileMaxQueries)) {
        expect(width, `${name} should treat ${width}px as mobile`).toBeLessThanOrEqual(Number(match![1]))
      }
      expect(width).toBeLessThan(DESKTOP_MIN_WIDTH)
    }
  })
})
