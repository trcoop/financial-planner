/**
 * Shared data contracts for the projection engine.
 *
 * These shapes are the contract the deterministic projection (Story 1), the Monte Carlo
 * simulation (Story 2), and the UI (Story 3) all build against — see ERD §4. Field names
 * and casing are fixed: camelCase throughout, matching the Story 1 PRD's output columns
 * exactly. Changing a name here is a breaking change for every consumer.
 *
 * Pure types only. No React, no I/O, no external dependencies (`architecture.md`).
 */

/**
 * A portfolio balance in dollars.
 *
 * Deliberately a bare `number` alias, not a struct: multi-asset-class breakdown and
 * rebalancing are explicitly deferred (Engine Architecture Design, "Explicitly deferred
 * decision"). This alias marks the one seam where that structure would land, so the swap
 * is a change at the growth-stage boundary rather than a signature change everywhere a
 * balance is touched.
 *
 * Dollars are plain IEEE-754 floats with no intermediate rounding anywhere in the engine.
 * Rounding to the cent is a display-only concern owned by `src/ui/` (ERD §5).
 */
export type PortfolioValue = number;

/** The ten scalar inputs a projection runs from (Story 1 PRD, Inputs). */
export interface PlanAssumptions {
  currentAge: number;
  retirementAge: number;
  initialBalance: number;
  currentAnnualIncome: number;
  /** Decimal, not percent — 0.15 means 15%. */
  annualContributionRate: number;
  /** Decimal — 0.03 means 3%. */
  annualRaiseRate: number;
  /** Decimal — 0.07 means 7%. */
  annualReturnRate: number;
  /** Decimal — 0.025 means 2.5%. */
  inflationRate: number;
  /** Decimal — 0.04 means 4%. */
  withdrawalRateInRetirement: number;
  /** Fixed at 100 for Stories 1-3 per Story 3's call-site default. */
  planningHorizonEndAge: number;
}

/**
 * One year of projected output.
 *
 * Row count is inclusive of both endpoints: age 35 through 100 is 66 rows, `year` running
 * 0 through 65. The 1-indexed "Year" column the user sees (`year + 1`) is a Story 3 UI
 * display mapping, not an engine concern.
 */
export interface ProjectionRow {
  /** Age at the start of this year. */
  age: number;
  /** Years elapsed. 0-indexed: year 0 is the current year, at `currentAge`. */
  year: number;
  /** Balance at the start of the year, before returns, contributions, and withdrawals. */
  beginningBalance: PortfolioValue;
  /** Dollars contributed this year. Always 0 in retirement. */
  annualContribution: number;
  /**
   * Dollars earned from investment returns: `beginningBalance * returnForPeriod`.
   *
   * Deliberately stated against the period's return rather than
   * `assumptions.annualReturnRate`: this same row type is the per-path output of Monte
   * Carlo, where the multiplier is that period's GBM draw. The deterministic projection
   * is the case where `returnForPeriod` happens to equal `annualReturnRate` every year.
   */
  investmentReturn: number;
  /** Dollars withdrawn this year. Always 0 pre-retirement. */
  annualWithdrawal: number;
  /** Balance at the end of the year. May go negative — that is a valid failure state. */
  endingBalance: PortfolioValue;
}

/**
 * A user-defined life event consumed by the `applyLifeEvents` stage.
 *
 * Always `[]` for Stories 1-3 — no UI populates it yet. The stage consumes the list from
 * day one so later stories add event types additively, without a pipeline change.
 */
export type PlanEvent =
  | { type: 'oneTimeExpense'; atAge: number; amount: number; label: string }
  | { type: 'durationExpense'; startAge: number; endAge: number; annualAmount: number; label: string };

/**
 * State threaded from one period to the next by the fold.
 *
 * `beginningBalance` and `investmentReturn` are working fields, not carried history:
 * `applyGrowth` carries them forward into the state it returns, alongside a `balance` set
 * to the post-growth value, and `recordPeriod` reads them back when constructing the row.
 * Without them, neither value is recoverable by the time the last stage runs (ERD §4,
 * round 2 review).
 *
 * Every stage returns a new state rather than mutating the one it was given — see
 * {@link PipelineStage}. Where `applyGrowth`'s own doc in `pipeline.ts` says it
 * "snapshots" `beginningBalance` and "overwrites" `balance`, that describes the value
 * flow, not in-place assignment.
 */
export interface PeriodState {
  age: number;
  /** 0-indexed, mirrors `ProjectionRow.year`. */
  year: number;
  /** Balance carried into the next period; equals the prior period's `endingBalance`. */
  balance: PortfolioValue;
  /** Last computed annual income, used to apply `annualRaiseRate` the following period. */
  priorIncome: number;
  /**
   * Last annual withdrawal, used to inflation-adjust the following period's withdrawal.
   * `null` until the first retirement-year withdrawal is set.
   *
   * OPEN DECISION (raised in FIN-15 review, not yet resolved): when a
   * {@link WithdrawalStrategy} satisfies only part of the requested `shortfall`, does this
   * field carry the *requested* figure or the *sourced* `WithdrawalPlan.amount`? The two
   * are identical under `withdrawFullShortfall`, so nothing in Stories 1-3 can
   * distinguish them and no test here pins it. They diverge the moment a partially-
   * satisfying strategy ships (Story 4+), at which point the inflation chain compounds
   * whichever one was chosen. FIN-16 must not pick silently — resolve it on the ticket
   * first and record the answer here.
   */
  priorWithdrawal: number | null;
  /** Output rows accumulated so far; `recordPeriod` appends this period's row. */
  rows: ProjectionRow[];
  /** This period's balance before `applyGrowth` ran. Set by `applyGrowth`, read by `recordPeriod`. */
  beginningBalance: PortfolioValue;
  /** This period's investment-return dollars. Set by `applyGrowth`, read by `recordPeriod`. */
  investmentReturn: number;
}

/** What a {@link WithdrawalStrategy} decided to actually withdraw. */
export interface WithdrawalPlan {
  /** Dollars to withdraw this period. */
  amount: number;
}

/**
 * Decides how to source a period's intended withdrawal.
 *
 * `shortfall` is the dollar figure `computeWithdrawals` already determined is needed this
 * period — `balanceAtStartOfFirstRetirementYear * withdrawalRateInRetirement` in the first
 * retirement year, `priorWithdrawal * (1 + inflationRate)` after that, and 0
 * pre-retirement. The strategy decides only where it comes from.
 *
 * This is the seam for later multi-account/tax-aware withdrawal sequencing, which is why
 * it returns a {@link WithdrawalPlan} rather than a bare number: a smarter strategy may
 * satisfy only part of `shortfall` from this balance and source the rest elsewhere.
 *
 * Strategies are trusted internal collaborators, not user input. A throwing strategy is an
 * engine bug, not an `InvalidProjectionInputError` (ERD §6).
 */
export type WithdrawalStrategy = (state: PeriodState, shortfall: number) => WithdrawalPlan;

/**
 * Where in the plan a tax computation is happening.
 *
 * Ignored entirely by the Stories 1-3 stub. Reserved so that a real bracket-math
 * implementation (keyed by age/year) does not have to change `TaxCalculator`'s signature.
 */
export interface TaxContext {
  age: number;
  year: number;
}

/** What a {@link TaxCalculator} determined is owed. */
export interface TaxResult {
  taxOwed: number;
}

/**
 * Computes tax owed on a period's income and withdrawals.
 *
 * Like {@link WithdrawalStrategy}, a trusted internal collaborator rather than a
 * validation boundary.
 */
export type TaxCalculator = (income: number, withdrawals: number, context: TaxContext) => TaxResult;

/**
 * Everything a single period needs beyond the state carried into it.
 *
 * `returnForPeriod` is the seam that makes Monte Carlo a reuse of the projection rather
 * than a reimplementation: the deterministic fold passes `annualReturnRate` every period,
 * while a Monte Carlo trial passes that period's GBM draw.
 */
export interface RunPeriodInput {
  /** Events active this period. Always `[]` for Stories 1-3. */
  events: PlanEvent[];
  assumptions: PlanAssumptions;
  /** This period's market return, as a decimal. */
  returnForPeriod: number;
  withdrawalStrategy: WithdrawalStrategy;
  taxCalculator: TaxCalculator;
}

/**
 * One stage of the per-period pipeline.
 *
 * Every stage has the same shape so the period is a plain fold over an ordered list. A
 * stage returns a new state rather than mutating the one it is given — the engine is a
 * pure function of its inputs.
 */
export type PipelineStage = (state: PeriodState, input: RunPeriodInput) => PeriodState;
