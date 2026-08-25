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
   * Dollars earned from investment returns:
   * `(beginningBalance - annualWithdrawal) * returnForPeriod`.
   *
   * Net of the withdrawal, not on the opening balance: FIN-65 change 2 moved
   * `computeWithdrawals` ahead of `applyGrowth`, so a retiree's spending leaves the
   * portfolio at the start of the year and only the remainder compounds. That is the
   * convention the published safe-withdrawal-rate studies use.
   *
   * Deliberately stated against the period's return rather than
   * `assumptions.annualReturnRate`: this same row type is the per-path output of Monte
   * Carlo, where the multiplier is that period's draw. The deterministic projection
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
 * `beginningBalance` and `investmentReturn` are working fields, not carried history.
 * `snapshotBeginningBalance` records the opening balance (it was split out of `applyGrowth`
 * in FIN-65 change 2, so that the withdrawal stage can run in between); `applyGrowth` sets
 * `investmentReturn` alongside a `balance` set to the post-growth value; and `recordPeriod`
 * reads both back when constructing the row. Without them, neither value is recoverable by
 * the time the last stage runs (ERD §4, round 2 review).
 *
 * Every stage returns a new state rather than mutating the one it was given — see
 * {@link PipelineStage}. Where those stages' own docs in `pipeline.ts` speak of
 * "snapshotting" or "overwriting", that describes the value flow, not in-place assignment.
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
   * Carries the *requested* withdrawal — the `shortfall` {@link WithdrawalStrategy} was
   * asked for — and never the *sourced* {@link WithdrawalPlan} `amount` it managed to
   * supply. Resolved 2026-08-15 (raised in FIN-15 review); FIN-16's `computeWithdrawals`
   * must inflate this figure, not the sourced one.
   *
   * The two are identical under `withdrawFullShortfall`, so nothing in Stories 1-3 can
   * distinguish them — they diverge the moment a partially-satisfying strategy ships
   * (Story 4+), and by then the inflation chain has been compounding one of them for
   * decades. This models a *spending need*: a retiree's cost of living rises with
   * inflation whether or not the portfolio could fund last year's draw. Compounding the
   * sourced amount instead would silently ratchet planned spending down after any
   * shortfall, so a failing plan would appear to recover — hiding exactly the failure
   * state Story 1 requires the engine to surface.
   */
  priorWithdrawal: number | null;
  /** Output rows accumulated so far; `recordPeriod` appends this period's row. */
  rows: ProjectionRow[];
  /** This period's balance before `applyGrowth` ran. Set by `applyGrowth`, read by `recordPeriod`. */
  beginningBalance: PortfolioValue;
  /** This period's investment-return dollars. Set by `applyGrowth`, read by `recordPeriod`. */
  investmentReturn: number;
  /**
   * This period's contribution dollars. Set by `computeIncome`, read by `recordPeriod`.
   *
   * ERD §4 originally judged this field unnecessary on the grounds that `recordPeriod`
   * could re-derive it from `priorIncome * annualContributionRate`. Carried explicitly
   * instead, because re-deriving would duplicate `computeIncome`'s pre-retirement/retirement
   * branch inside `recordPeriod` — two places that must agree about which phase the period
   * is in, and that a later `PlanEvent` affecting contributions would silently desync.
   */
  annualContribution: number;
  /**
   * This period's withdrawal dollars as actually *sourced*. Set by `computeWithdrawals`
   * from the {@link WithdrawalPlan} it received, read by `recordPeriod`.
   *
   * Deliberately distinct from {@link PeriodState.priorWithdrawal}, which carries the
   * *requested* figure. `ProjectionRow.annualWithdrawal` reports money that actually left
   * the portfolio, and it is this amount — not the request — that the ending balance is
   * reduced by, so it cannot be re-derived from `priorWithdrawal` once a partially-
   * satisfying strategy ships (Story 4+).
   */
  annualWithdrawal: number;
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
  /**
   * This period's cost-of-living increase, as a decimal, when the caller knows it.
   *
   * Present only on the Monte Carlo *historical* path (FIN-65), where each period's return is
   * drawn from a real historical year and this carries that same year's realised CPI-U — the
   * two must move together, or the engine runs nominal returns against an invented inflation
   * rate and systematically flatters high-inflation cohorts.
   *
   * Optional because the two callers that have no historical year to key off — the
   * deterministic projection, and Monte Carlo's GBM branch — deliberately fall back to the
   * plan's own `inflationRate` instead. See {@link computeWithdrawals}.
   */
  inflationForPeriod?: number;
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
