import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'

// Root-level `afterEach` hooks (registered outside any `describe`, as this one is) run AFTER a
// test file's own local `afterEach` hooks (e.g. `afterEach(() => cleanup())` in individual
// describe blocks) — so this always runs last, once per test, after any unmount/cleanup has
// already had a chance to write to `localStorage`.
//
// Without this, real (jsdom-backed) `localStorage` persists for the whole lifetime of a test
// file (jsdom's `window` isn't recreated per test), so anything a test writes to it — directly,
// via a debounced save effect settling during a slow `waitFor`, or via an unmount-time flush
// effect — silently bleeds into every later test in the file that doesn't stub its own storage.
// That bled-in state (e.g. a leftover second Person from an earlier test that added a spouse)
// then loads on the next test's fresh mount, producing failures that look unrelated to storage
// at all (e.g. duplicate "Retirement age" fields). This was masked in one specific local dev
// environment (a very new Node major where `window.localStorage` turned out not to behave like
// a real Storage implementation — see the `createFakeStorage` comment in PlanSection.test.tsx),
// which is exactly why it went unnoticed there but reproduced in CI (Node 20, real jsdom
// localStorage). Clearing it after every test removes the bleed regardless of Node version.
afterEach(() => {
  try {
    window.localStorage.clear()
  } catch {
    // Some environments' `window.localStorage` isn't a real Storage implementation (no
    // `clear`) — nothing to clean up there.
  }
})

// jsdom doesn't implement scrollIntoView (used by ChartContainer's auto-scroll-to-selected
// effect, see FIN-35).
if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = () => {}
}

// jsdom doesn't implement ResizeObserver (used by ChartContainer's band-position measurement
// effect, see FIN-42). A no-op stub is sufficient for tests, which drive re-measurement
// directly by re-rendering rather than by resizing anything.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
