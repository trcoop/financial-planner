/**
 * The deterministic projection (Story 1, Tier 1): the engine's public entry point.
 *
 * Validates its inputs once at the boundary, then folds {@link runPeriod} across every year
 * from `currentAge` through `planningHorizonEndAge`. Pure and synchronous — same inputs
 * always produce the same rows, and nothing the caller passes in is mutated.
 *
 * Kept separate from `pipeline.ts` so the per-period step function stays free of any notion
 * of a horizon: Monte Carlo folds that same step function over its own per-path returns.
 */

import { InvalidProjectionInputError } from './errors';
import { runPeriod } from './pipeline';
import { withdrawFullShortfall, zeroTax } from './strategies';
import type { PeriodState, PlanAssumptions, PlanEvent, ProjectionRow, RunPeriodInput } from './types';

/** Every numeric field of {@link PlanAssumptions}, for the finiteness sweep. */
const NUMERIC_FIELDS = [
  'currentAge',
  'retirementAge',
  'initialBalance',
  'currentAnnualIncome',
  'annualContributionRate',
  'annualRaiseRate',
  'annualReturnRate',
  'inflationRate',
  'withdrawalRateInRetirement',
  'planningHorizonEndAge',
] as const satisfies ReadonlyArray<keyof PlanAssumptions>;

/** Rates that run through the engine's `x * (1 + rate)` formulas. */
const COMPOUNDING_RATE_FIELDS = ['annualReturnRate', 'inflationRate', 'annualRaiseRate'] as const;

/**
 * Rejects any caller-supplied assumptions the projection cannot meaningfully run on.
 *
 * A single up-front pass, before any folding, so a rejected input never yields partial rows
 * (ERD §6). Finiteness is checked across every field first — the range comparisons below
 * would silently pass on `NaN`, which compares false against everything — and the remaining
 * checks throw on the first violation found.
 *
 * Exported because Story 2's `runMonteCarlo` validates the same `PlanAssumptions` at its own
 * boundary and must produce identical codes for identical inputs.
 *
 * Note what is deliberately *absent*: `retirementAge <= currentAge` is the valid
 * already-retired scenario, not an error, and a *computed* balance going negative
 * mid-projection is a legitimate plan-failure outcome. Only `initialBalance` itself is
 * range-checked here.
 *
 * @throws {InvalidProjectionInputError}
 */
export const validatePlanAssumptions = (assumptions: PlanAssumptions): void => {
  for (const field of NUMERIC_FIELDS) {
    const value = assumptions[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new InvalidProjectionInputError(
        'NON_FINITE_INPUT',
        `${field} must be a finite number, received ${String(value)}.`,
      );
    }
  }

  const {
    currentAge,
    retirementAge,
    planningHorizonEndAge,
    initialBalance,
    currentAnnualIncome,
    annualContributionRate,
    withdrawalRateInRetirement,
  } = assumptions;

  if (currentAge < 0 || retirementAge < 0 || planningHorizonEndAge < 0) {
    throw new InvalidProjectionInputError(
      'NEGATIVE_AGE',
      `Ages must not be negative, received currentAge ${currentAge}, retirementAge ${retirementAge}, planningHorizonEndAge ${planningHorizonEndAge}.`,
    );
  }

  if (currentAge > planningHorizonEndAge) {
    throw new InvalidProjectionInputError(
      'CURRENT_AGE_EXCEEDS_HORIZON',
      `currentAge ${currentAge} is past planningHorizonEndAge ${planningHorizonEndAge}, leaving no years to project.`,
    );
  }

  if (initialBalance < 0) {
    throw new InvalidProjectionInputError(
      'NEGATIVE_BALANCE_INPUT',
      `initialBalance must not be negative, received ${initialBalance}.`,
    );
  }

  if (currentAnnualIncome < 0) {
    throw new InvalidProjectionInputError(
      'NEGATIVE_INCOME',
      `currentAnnualIncome must not be negative, received ${currentAnnualIncome}.`,
    );
  }

  for (const field of COMPOUNDING_RATE_FIELDS) {
    if (assumptions[field] < -1) {
      throw new InvalidProjectionInputError(
        'RATE_BELOW_NEGATIVE_100_PERCENT',
        `${field} must not be below -1 (-100%), received ${assumptions[field]}.`,
      );
    }
  }

  if (annualContributionRate < 0 || annualContributionRate > 1) {
    throw new InvalidProjectionInputError(
      'CONTRIBUTION_RATE_OUT_OF_RANGE',
      `annualContributionRate must be between 0 and 1, received ${annualContributionRate}.`,
    );
  }

  if (withdrawalRateInRetirement < 0 || withdrawalRateInRetirement > 1) {
    throw new InvalidProjectionInputError(
      'WITHDRAWAL_RATE_OUT_OF_RANGE',
      `withdrawalRateInRetirement must be between 0 and 1, received ${withdrawalRateInRetirement}.`,
    );
  }
};

/**
 * The state a projection starts from, at year 0 and `currentAge`.
 *
 * The working fields (`beginningBalance`, `investmentReturn`, `annualContribution`,
 * `annualWithdrawal`) are zeroed rather than pre-populated: every one of them is written by
 * the stage that owns it before `recordPeriod` reads it, so a zero here is a placeholder
 * that a broken stage would leave visible in year 0's row rather than mask.
 *
 * Exported for Story 2, whose per-path fold starts from this same state.
 */
export const createInitialPeriodState = (assumptions: PlanAssumptions): PeriodState => ({
  age: assumptions.currentAge,
  year: 0,
  balance: assumptions.initialBalance,
  priorIncome: 0,
  priorWithdrawal: null,
  rows: [],
  beginningBalance: 0,
  investmentReturn: 0,
  annualContribution: 0,
  annualWithdrawal: 0,
});

/** Moves a completed period on to the next year. */
const advance = (state: PeriodState): PeriodState => ({ ...state, age: state.age + 1, year: state.year + 1 });

/**
 * Projects wealth year by year from `currentAge` through `planningHorizonEndAge`.
 *
 * Row count is inclusive of both endpoints — age 35 through 100 is 66 rows, `year` 0 through
 * 65. Balances are plain IEEE-754 floats with no rounding at any step; cent-level formatting
 * is the UI's job (ERD §5).
 *
 * @throws {InvalidProjectionInputError} if any assumption violates the contract in §6.
 */
/**
 * Clamps a ruined period to zero, and keeps it there (FIN-65 change 6).
 *
 * Applied by {@link runProjection} after each `runPeriod`, deliberately at the loop level
 * rather than inside {@link withdrawFullShortfall}: `WithdrawalStrategy` is a caller-injected
 * seam, and "a portfolio cannot hold less than nothing" is a property of the engine, not of
 * whichever strategy happens to be plugged in. {@link runMonteCarloTrial} made the same call
 * at the same layer at FIN-65 change 4, so the two engines stay structurally parallel.
 *
 * Three things happen in the year the money runs out, and the third is the one worth reading
 * twice:
 *
 * 1. `balance` is floored at zero, and `ruined` latches so later periods cannot resurrect the
 *    plan on a contribution or a good return year.
 * 2. The recorded row's `endingBalance` is floored to match — `state.rows` IS this function's
 *    output, so unlike the Monte Carlo case every later row needs it, not just this one.
 * 3. The *withdrawal* is cut back to what the portfolio could actually fund, rather than
 *    reporting the full requested draw. This is what keeps `beginningBalance -
 *    annualWithdrawal + investmentReturn + annualContribution = endingBalance` true in the
 *    ruin year — the identity {@link toTodaysDollarRows} is built around and the year-detail
 *    panel renders as a breakdown a reader can add up. Flooring `endingBalance` alone would
 *    leave that breakdown short by exactly the overshoot, in the single year a user is most
 *    likely to click on. `investmentReturn` follows for the same reason: growth ran on
 *    `beginningBalance - withdrawal`, which the cutback takes to zero.
 *
 * **The `ruined` latch is currently unreachable, and is kept on purpose.** Nothing in today's
 * engine can resurrect a zeroed plan without it: `isRetired` is monotonic in age, so a period
 * that withdraws can never be followed by one that contributes, and `0 * (1 + r)` is 0 for any
 * return. Flooring each period independently would therefore produce identical output, and a
 * mutation that removes the latch survives the suite — verified, not assumed. It stays because
 * {@link applyLifeEvents} is a declared future stage that can credit money mid-projection (an
 * inheritance, a property sale), and at that point "a contribution cannot revive a plan that
 * already failed" becomes a live behavioural question rather than an arithmetic inevitability.
 * `runMonteCarloTrial` answered it that way at FIN-65 change 4, where the shared-RNG structure
 * makes its equivalent gate reachable and tested. Deleting this would silently pick the
 * opposite answer for the Plan tab on the day life events land.
 *
 * **Three smaller pieces here are likewise dead in every state the engine can reach today**, so
 * a mutation deleting any one of them survives the suite. Round 5 of the FIN-65 review flagged
 * them; they are kept as guards, with the reachability arguments recorded so the next reader
 * does not have to re-derive them:
 *
 * - The `lastRow === undefined` branch. {@link recordPeriod} is the last stage of `runPeriod`,
 *   so `state.rows` is non-empty on every call this function receives. The alternative is a
 *   non-null assertion, which turns a pipeline reordering into a silent `undefined` spread.
 * - The `Math.max(0, ...)` in `funded`. Both arguments to the inner `Math.min` are already
 *   non-negative: `beginningBalance` is either the validated `initialBalance` or a previously
 *   clamped ending, and a withdrawal never goes below zero.
 * - The `- lastRow.annualContribution` term in the derived return. A period with a contribution
 *   is by definition pre-retirement (see `isRetired` in `pipeline.ts`), so its withdrawal is
 *   zero; and {@link validatePlanAssumptions} floors `annualReturnRate` at -1. Such a period
 *   therefore ends on `beginningBalance * (1 + r) + contribution >= contribution > 0` and can
 *   never trigger the clamp. The term stays because it is what makes the identity hold *by
 *   construction* rather than by coincidence — and it is the first thing that becomes live if
 *   {@link applyLifeEvents} ever credits money to a plan that is already failing.
 *
 * `priorWithdrawal` is deliberately NOT cut back — it carries the inflation-indexed spending
 * *need*, which keeps rising whether or not the portfolio can fund it. See
 * {@link computeWithdrawals}.
 */
const clampRuin = (state: PeriodState, ruined: boolean): { state: PeriodState; ruined: boolean } => {
  if (!ruined && state.balance > 0) {
    return { state, ruined: false };
  }

  const lastRow = state.rows[state.rows.length - 1];
  if (lastRow === undefined) {
    return { state: { ...state, balance: 0 }, ruined: true };
  }

  // The shortfall is only meaningful in the year ruin actually happens; afterwards every
  // component is already zero because the period opened on a zero balance.
  const funded = Math.max(0, Math.min(lastRow.annualWithdrawal, lastRow.beginningBalance));

  return {
    state: {
      ...state,
      balance: 0,
      rows: [
        ...state.rows.slice(0, -1),
        {
          ...lastRow,
          annualWithdrawal: funded,
          // Derived, not recomputed from the period's rate: whatever growth ran on, the row
          // must close on a zero ending balance. Solving the breakdown identity for the return
          // gives this. It is exact in every reachable case, not merely close: in the ordinary
          // ruin year the cutback takes `funded` to `beginningBalance` with no contribution, so
          // this is exactly 0; in a year that lands on zero with the draw fully funded (scenario
          // B's age 66) `funded` still equals `beginningBalance`, likewise 0; and in every year
          // after ruin all three terms are already 0.
          investmentReturn: funded - lastRow.beginningBalance - lastRow.annualContribution,
          endingBalance: 0,
        },
      ],
    },
    ruined: true,
  };
};

export const runProjection = (assumptions: PlanAssumptions, events: PlanEvent[] = []): ProjectionRow[] => {
  validatePlanAssumptions(assumptions);

  const input: RunPeriodInput = {
    events,
    assumptions,
    // The deterministic case: every period draws the same fixed rate. Monte Carlo varies
    // this per period through the identical pipeline.
    returnForPeriod: assumptions.annualReturnRate,
    withdrawalStrategy: withdrawFullShortfall,
    taxCalculator: zeroTax,
  };

  let state = createInitialPeriodState(assumptions);
  let ruined = false;
  while (state.age <= assumptions.planningHorizonEndAge) {
    state = runPeriod(state, input);
    // FIN-65 change 6. A portfolio cannot go below zero, and zero absorbs. See `clampRuin`.
    ({ state, ruined } = clampRuin(state, ruined));
    state = advance(state);
  }

  return state.rows;
};

/**
 * Restates a nominal projection in today's dollars (FIN-65 change 3).
 *
 * `runProjection` compounds `annualReturnRate` as a nominal return, so its output is future
 * dollars: over a 65-year horizon at 2.5% inflation the price level roughly quintuples, and
 * a headline "$5M at 100" is about $1M of today's groceries. Presenting that number without
 * saying so is the single biggest way a projection misleads, so the display layer deflates —
 * exactly the split ProjectionLab uses (simulate nominal, deflate at display), which lets the
 * nominal series stay available for a future toggle rather than being thrown away.
 *
 * Every field in a row is divided by the same price level, the one at the END of that year.
 * That choice is what preserves `endingBalance = beginningBalance - annualWithdrawal +
 * investmentReturn + annualContribution`, which the year-detail panel shows as a breakdown a
 * reader can add up. The alternative — deflating `beginningBalance` by the START-of-year
 * level, so that it equals the previous row's real ending balance — is equally defensible on
 * its own terms and breaks that identity by a year of inflation. Both cannot hold at once;
 * the breakdown adding up is the one a reader will actually check.
 *
 * Note the consequence for `annualWithdrawal`: retirement withdrawals are indexed to
 * inflation, so in real terms they are flat by construction. That flat line is the correct
 * number to display and carries no information about the plan.
 */
export const toTodaysDollarRows = (
  rows: readonly ProjectionRow[],
  inflationRate: number,
): ProjectionRow[] =>
  rows.map((row, year) => {
    const priceLevel = (1 + inflationRate) ** (year + 1);

    return {
      ...row,
      beginningBalance: row.beginningBalance / priceLevel,
      annualContribution: row.annualContribution / priceLevel,
      investmentReturn: row.investmentReturn / priceLevel,
      annualWithdrawal: row.annualWithdrawal / priceLevel,
      endingBalance: row.endingBalance / priceLevel,
    };
  });

/**
 * The Fisher relation: what a nominal return is worth once inflation is taken out.
 *
 *   real = (1 + nominal) / (1 + inflation) - 1
 *
 * Not `nominal - inflation`. The subtraction is close enough to pass a glance (4.5% vs 4.39%
 * at 7% and 2.5%) and wrong enough to matter compounded over a planning horizon.
 *
 * Exposed so the UI can show the real return alongside the nominal one the user types
 * (FIN-65 change 3). Once balances are displayed in today's dollars, "7% return" and a chart
 * that grows at ~4.4% look contradictory unless the real rate is stated somewhere the user
 * can see it.
 */
export const realReturn = (nominalRate: number, inflationRate: number): number =>
  (1 + nominalRate) / (1 + inflationRate) - 1;
