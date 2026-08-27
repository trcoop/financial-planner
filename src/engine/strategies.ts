/**
 * Default {@link WithdrawalStrategy} and {@link TaxCalculator} implementations for
 * Stories 1-3.
 *
 * Both are deliberately trivial. They exist so the pipeline's call sites and return shapes
 * are real from day one, which means a later tax-aware withdrawal sequencer or bracket-math
 * tax calculator is a swap behind an existing interface rather than a change to the step
 * function (Engine Architecture Design, Extensibility mapping).
 */

import type { TaxCalculator, WithdrawalStrategy } from './types';

/**
 * Withdraws the full requested shortfall from the single portfolio balance.
 *
 * Does not clamp to the available balance — deliberately, but this is no longer what the
 * projection reports. A `WithdrawalStrategy` is a caller-injected seam, so it answers "how much
 * does this plan want to take out", not "what can a portfolio physically hold"; the latter is a
 * property of the engine and belongs at the loop level, where both engines now enforce it (see
 * `clampRuin` in `projection.ts` and the ruin gate in `runMonteCarloTrial`). Returning the full
 * request here is what lets those two compute the shortfall.
 *
 * This comment used to read: "a plan that runs dry keeps projecting into negative territory,
 * which is the failure state Story 1 explicitly requires the engine to show rather than hide."
 * Reversed by Travis on 2026-08-26 (FIN-65 change 6). Story 1's requirement stands — a failing
 * plan must be shown, not hidden — but a reported balance of *negative* $150,775 was not that
 * failure being shown. Nothing in this engine models borrowing, so the negative tail was
 * unclamped arithmetic continuing past the point the plan died. Flatlining at zero shows the
 * same failure without asserting a debt that was never simulated. The trigger: once FIN-65
 * change 3 put the Plan tab in today's dollars, the default plan at a 100% bond allocation
 * crossed zero at 96 and read -$150,775 at 100 — the chart's y-axis floor hid it, but the hover
 * tooltip and the year-detail panel both read the row directly and showed it as fact.
 */
export const withdrawFullShortfall: WithdrawalStrategy = (_state, shortfall) => ({
  amount: shortfall,
});

/**
 * Owes no tax, ever. Taxes are out of scope for the MVP.
 */
export const zeroTax: TaxCalculator = (_income, _withdrawals, _context) => ({
  taxOwed: 0,
});
