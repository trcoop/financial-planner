import '@testing-library/jest-dom/vitest'

// jsdom doesn't implement scrollIntoView (used by ChartContainer's auto-scroll-to-selected
// effect, see FIN-35).
if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = () => {}
}
