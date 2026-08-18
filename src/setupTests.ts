import '@testing-library/jest-dom/vitest'

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
