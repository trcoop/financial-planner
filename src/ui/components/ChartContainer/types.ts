/**
 * Presentation-layer shape for one projected year, consumed by `ChartContainer` and
 * `YearDetailPanel`. Deliberately not imported from `src/engine` (CLAUDE.md: `src/ui/`
 * components must not call into or import the engine) — this is a structural subset of
 * `src/engine`'s `ProjectionRow` that the integration ticket (FIN-26) maps real
 * `runProjection` rows onto when wiring this into `App.tsx`.
 */
export interface ChartRow {
  /** Age at the start of this year. */
  age: number
  /** Years elapsed, 0-indexed. */
  year: number
  /** Balance at the start of the year. */
  beginningBalance: number
  /** Dollars contributed this year. */
  annualContribution: number
  /** Dollars earned from investment returns this year. */
  investmentReturn: number
  /** Dollars withdrawn this year. Zero pre-retirement. */
  annualWithdrawal: number
  /** Balance at the end of the year. */
  endingBalance: number
}

/** One year's Monte Carlo 10th/90th percentile band, keyed by the same `year` a `ChartRow`
 * uses. A parallel structure rather than fields bolted onto `ChartRow`, because band data is
 * optional and arrives later (after a stress test completes) than `rows` does — keeping it
 * separate avoids threading `p10`/`p90: number | undefined` through every `ChartRow` consumer
 * that has nothing to do with Monte Carlo (e.g. `YearDetailPanel`). No `p50` field — see ERD
 * §2.1: this story does not plot a median line. */
export interface ChartBandRow {
  year: number
  p10: number
  p90: number
}
