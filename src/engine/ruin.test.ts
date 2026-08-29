/**
 * FIN-67: shared ruin/clamp core.
 *
 * `projection.ts`'s `clampRuin` (deterministic) and `monteCarlo.ts`'s inline ruin tracking in
 * `runMonteCarloTrial` both floor a ruined period's balance at zero and latch that the path is
 * ruined so a later contribution or good return year cannot resurrect it (FIN-65 changes 4 and
 * 6). That much is identical and is what this module consolidates.
 *
 * They are NOT fully identical beyond that: `clampRuin` also cuts back `annualWithdrawal`,
 * zeroes `eventCosts`, and derives `investmentReturn` so the ruin-year row's
 * `begin - withdrawal + return + contribution = end` identity still holds for the Plan tab's
 * year-detail panel. Monte Carlo's per-path loop does not do this — it patches only `balance`
 * and `rows[last].endingBalance`, leaving withdrawal/eventCosts/investmentReturn at their raw,
 * unclamped pipeline values. That divergence is deliberately NOT consolidated here (FIN-67
 * constraint #4/#5) — flagged in the ticket rather than silently resolved.
 */
import { describe, expect, it } from 'vitest';

import { clampRuinedBalance } from './ruin';

describe('clampRuinedBalance', () => {
  it('passes a positive balance through unchanged when not yet ruined', () => {
    expect(clampRuinedBalance(1000, false)).toEqual({ balance: 1000, ruined: false });
  });

  it('floors a zero-or-negative balance to zero and latches ruined', () => {
    expect(clampRuinedBalance(0, false)).toEqual({ balance: 0, ruined: true });
    expect(clampRuinedBalance(-500, false)).toEqual({ balance: 0, ruined: true });
  });

  it('keeps a balance at zero once already ruined, even if the raw balance recovered', () => {
    // A later contribution or return that would push a naive balance back above zero must not
    // resurrect a plan that already failed (FIN-65 change 4/6: ruin is absorbing).
    expect(clampRuinedBalance(2000, true)).toEqual({ balance: 0, ruined: true });
  });

  it('stays ruined across repeated calls with the latch carried forward', () => {
    const first = clampRuinedBalance(-100, false);
    const second = clampRuinedBalance(50, first.ruined);

    expect(second).toEqual({ balance: 0, ruined: true });
  });
});
