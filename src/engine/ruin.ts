/**
 * Shared ruin/clamp core (FIN-67). See `ruin.test.ts`'s file doc comment for exactly what is
 * and is not consolidated here, and why.
 *
 * A portfolio cannot hold less than nothing, and ruin is absorbing: once a path/period's balance
 * hits zero or below, it is floored at zero and stays there — a later contribution or a good
 * return year must not resurrect a plan that already failed (FIN-65 changes 4 and 6). Both
 * `projection.ts`'s deterministic `clampRuin` and `monteCarlo.ts`'s per-path ruin tracking apply
 * exactly this rule to the reported balance; this function is that shared rule, taking the
 * latch as an explicit `alreadyRuined` input/output pair so each caller can carry it through its
 * own loop shape (a single boolean across periods for the deterministic projection, a
 * `ruinPeriod: number | null` per path for Monte Carlo) without this function knowing which.
 */
export const clampRuinedBalance = (
  balance: number,
  alreadyRuined: boolean,
): { balance: number; ruined: boolean } => {
  const ruined = alreadyRuined || balance <= 0;

  return { balance: ruined ? 0 : balance, ruined };
};
