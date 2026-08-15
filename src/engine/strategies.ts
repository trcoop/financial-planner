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
 * Does not clamp to the available balance: a plan that runs dry keeps projecting into
 * negative territory, which is the failure state Story 1 explicitly requires the engine to
 * show rather than hide.
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
