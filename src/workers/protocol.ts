/**
 * The `postMessage` contract between the main thread and the Monte Carlo worker (ERD §7).
 *
 * Shared by both sides of the boundary — `monteCarloOrchestrator.ts` (posts requests, receives
 * responses) and `monteCarloHandler.ts` (receives requests, returns responses) — so they cannot
 * drift apart on shape.
 */

import type {
  MonteCarloResult,
  PlanAssumptions,
  PlanEvent,
  PortfolioAllocation,
  ProjectionErrorCode,
  VolatilityAssumptions,
} from '../engine';

/**
 * Posted from the main thread into the worker.
 *
 * `events` is carried explicitly even though every Stories 1-3 caller passes `[]` (ERD §7,
 * round-1 review) — dropping it silently at this boundary would make the contract
 * non-additive for Story 4, which is expected to populate real `PlanEvent`s through this same
 * pipeline.
 */
export interface MonteCarloWorkerRequest {
  assumptions: PlanAssumptions;
  allocation: PortfolioAllocation;
  volatilityAssumptions: VolatilityAssumptions;
  events: PlanEvent[];
}

/**
 * Posted from the worker back to the main thread.
 *
 * The `error` variant is a plain, structured-clone-safe payload rather than the caught
 * `InvalidProjectionInputError` itself — a custom `Error` subclass's prototype chain does not
 * survive `postMessage` (ERD §7). `monteCarloOrchestrator.ts` reconstructs a real instance from
 * `{ code, message }` on the receiving side.
 */
export type MonteCarloWorkerResponse =
  | { type: 'success'; result: MonteCarloResult }
  | { type: 'error'; code: ProjectionErrorCode; message: string };
