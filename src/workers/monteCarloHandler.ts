/**
 * The pure core of the Monte Carlo worker script (ERD §3, §7): wraps FIN-17's
 * `runMonteCarloTrials`, converting a thrown `InvalidProjectionInputError` into the plain,
 * structured-clone-safe payload `postMessage` can actually carry across the worker boundary.
 *
 * Kept separate from `monteCarloWorkerEntry.ts` (the `self.onmessage` wiring) so this function
 * — the part with real logic — is importable and unit-testable outside a Worker context. The
 * entry file is untestable glue that only runs inside a real browser Worker.
 */

import { InvalidProjectionInputError, runMonteCarloTrials } from '../engine';
import type { MonteCarloWorkerRequest, MonteCarloWorkerResponse } from './protocol';

export const handleMonteCarloRequest = (request: MonteCarloWorkerRequest): MonteCarloWorkerResponse => {
  try {
    const result = runMonteCarloTrials(
      request.assumptions,
      request.allocation,
      request.volatilityAssumptions,
      request.events,
    );
    return { type: 'success', result };
  } catch (error) {
    if (error instanceof InvalidProjectionInputError) {
      return { type: 'error', code: error.code, message: error.message };
    }
    // Anything else is a bug in the engine's own strategy/tax collaborators, not caller input
    // (architecture.md: those are trusted internal collaborators). Let it surface as an
    // uncaught worker error rather than being misreported as a validation failure.
    throw error;
  }
};
