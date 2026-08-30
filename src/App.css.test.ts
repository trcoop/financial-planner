/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * jsdom has no layout engine, so it can't evaluate @media rules against a simulated viewport
 * width (unlike the `window.matchMedia` mock App.test.tsx uses for JS-driven responsive
 * behavior — that only helps code that reads matchMedia directly, which CSS media queries
 * don't). For pure-CSS responsive behavior like `.statTiles`'s mobile grid, the closest we can
 * assert in Vitest without a real browser is that App.css declares the expected rules — read
 * as source text rather than computed style.
 *
 * FIN-30: on mobile, StatTiles should go 2-up (third tile wraps to its own row) instead of
 * stacking full-width, using the app's unified breakpoint (960px is the desktop floor, i.e.
 * `max-width: 959px` for the mobile query — matching TabBar.module.css / Drawer.module.css
 * from FIN-32, rather than the bare `max-width: 960px` App.css used before this ticket).
 */
/**
 * Vite/Vitest stub out `*.css` imports at runtime (including `?raw` ones), so App.css can't
 * be pulled in as a regular module import in a test — reading it directly off disk with
 * Node's `fs` (Vitest itself runs on Node, from the repo root) is the reliable way to get its
 * real source text.
 */
const appCss = readFileSync(join(process.cwd(), 'src/App.css'), 'utf-8')

function ruleBodyFor(css: string, selector: string): string {
  const index = css.indexOf(selector)
  expect(index, `expected to find selector ${selector} in App.css`).toBeGreaterThan(-1)
  const openBrace = css.indexOf('{', index)
  const closeBrace = css.indexOf('}', openBrace)
  return css.slice(openBrace + 1, closeBrace)
}

describe('App.css .statTiles responsive grid', () => {
  it('defaults to an auto-fit multi-column grid at desktop widths', () => {
    const body = ruleBodyFor(appCss, '.statTiles {')
    expect(body).toMatch(/display:\s*grid/)
    expect(body).toMatch(/grid-template-columns:\s*repeat\(auto-fit/)
  })

  it('switches to an explicit 2-column grid below the unified 960px breakpoint (max-width: 959px)', () => {
    // Match a `.statTiles { ... }` rule directly (immediately, ignoring whitespace/comments)
    // nested inside an `@media (max-width: 959px) { ... }` block — a structural match rather
    // than a substring search, so it can't accidentally pick up the desktop-default
    // `.statTiles` rule that sits outside any media query.
    const nestedRulePattern =
      /@media \(max-width: 959px\)\s*\{\s*(?:\/\*[\s\S]*?\*\/\s*)?\.statTiles\s*\{([^}]*)\}\s*\}/
    const match = appCss.match(nestedRulePattern)
    expect(match, 'expected a .statTiles rule nested inside an @media (max-width: 959px) block').not.toBeNull()

    expect(match![1]).toMatch(/grid-template-columns:\s*repeat\(2,\s*1fr\)/)
  })

  it('does not introduce a new one-off breakpoint value for the mobile stat tile grid', () => {
    // Guard against reintroducing e.g. `max-width: 600px` or similar ad hoc values instead of
    // reusing the app's unified 959px/960px breakpoint (FIN-32). `599` is intentionally
    // allowed here — that's FIN-100's separate, spec-pinned breakpoint (ERD §6) for switching
    // between LeftNav and BottomTabBar, an unrelated concern from the stat tile grid this test
    // guards, not a stray one-off value for this feature.
    const otherMobileWidths = [...appCss.matchAll(/max-width:\s*(\d+)px/g)]
      .map((match) => match[1])
      .filter((width) => width !== '959' && width !== '960' && width !== '599')
    expect(otherMobileWidths).toEqual([])
  })
})
