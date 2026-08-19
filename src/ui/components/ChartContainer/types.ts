/**
 * Presentation-layer shape for one projected year, consumed by `YearDetailPanel` and mapped
 * into `PercentileLineChart`'s `LineChartRow` shape for the Plan tab's chart (FIN-60;
 * previously consumed directly by the now-removed bar-chart `ChartContainer`, FIN-47/FIN-26).
 * Deliberately not imported from `src/engine` (CLAUDE.md: `src/ui/` components must not call
 * into or import the engine) — this is a structural subset of `src/engine`'s `ProjectionRow`
 * that the integration ticket (FIN-26) maps real `runProjection` rows onto when wiring this
 * into `App.tsx`.
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
