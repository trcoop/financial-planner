/**
 * Presentation-layer shape for one projected year, consumed by `YearDetailPanel` and mapped
 * into `PercentileLineChart`'s `LineChartRow` shape for the Plan tab's chart (FIN-60;
 * previously consumed directly by the now-removed bar-chart `ChartContainer`, FIN-47/FIN-26).
 * Deliberately not imported from `src/engine` (CLAUDE.md: `src/ui/` components must not call
 * into or import the engine) — this is a structural subset of `src/engine`'s `ProjectionRow`
 * that the integration ticket (FIN-26) maps real `runProjection` rows onto when wiring this
 * into `App.tsx`. FIN-124 moved this out of `src/ui/components/` (where it lived as the
 * now-removed `ChartContainer`'s leftover folder) — naming hygiene, since there's no component
 * here to mount or write a Ladle story for.
 */
/**
 * One event's cost for a year, keyed by a stable id (never a positional index) — a structural
 * copy of `src/engine`'s `EventCostEntry` (Events & Medicare Cost ERD §4), kept separate per
 * this file's "deliberately not imported from `src/engine`" convention above.
 */
export interface EventCostEntry {
  /** Echoes the source `PlanEvent`'s `id`, e.g. `'medicarePartB'`. */
  id: string
  amount: number
}

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
  /** Per-event cost breakdown for this year (e.g. Medicare). Empty array, never `undefined`,
   * when no event is active this year (ERD §4/§9). */
  eventCosts: EventCostEntry[]
}
