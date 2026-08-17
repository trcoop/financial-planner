/**
 * Main-thread orchestration for the Monte Carlo Web Worker (ERD §3, §7): owns the worker's
 * lifecycle (spawn, `postMessage`, `terminate`/respawn on cancel), the `StressTestState`
 * machine, and reconstructing a real `InvalidProjectionInputError` from the worker's
 * structured-clone-safe error payload.
 *
 * The worker itself is injected via `WorkerFactory` rather than constructed inline, so tests
 * can substitute a fully-controllable fake (see `monteCarloOrchestrator.test.ts`) instead of a
 * real browser `Worker`, which jsdom/Vitest cannot instantiate. Mirrors the `runPeriodFn`
 * injection seam already used in `src/engine/monteCarlo.ts`.
 */

import { DEFAULT_VOLATILITY_ASSUMPTIONS, InvalidProjectionInputError } from '../engine';
import type { MonteCarloResult, PlanAssumptions, PlanEvent, PortfolioAllocation, VolatilityAssumptions } from '../engine';
import type { MonteCarloWorkerRequest, MonteCarloWorkerResponse } from './protocol';

/** ERD §7, including the `error` variant added after the initial pin. */
export type StressTestState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'cancelled' }
  | { status: 'complete'; result: MonteCarloResult }
  | { status: 'error'; code: string; message: string };

export class MonteCarloCancelledError extends Error {
  constructor() {
    super('Monte Carlo run was cancelled.');
    this.name = 'MonteCarloCancelledError';
  }
}

/**
 * The minimal subset of the browser `Worker` API the orchestrator needs. Lets tests substitute
 * a fake double instead of a real `Worker`, which does not exist in jsdom.
 */
export interface WorkerLike {
  postMessage(message: MonteCarloWorkerRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<MonteCarloWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export type WorkerFactory = () => WorkerLike;

/**
 * Vite requires the `new URL(...)`/`import.meta.url` form as a static, literal expression to
 * detect and bundle the worker script — do not extract the path to a variable.
 */
const defaultWorkerFactory: WorkerFactory = () =>
  new Worker(new URL('./monteCarloWorkerEntry.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;

export interface MonteCarloOrchestrator {
  getState(): StressTestState;
  subscribe(listener: (state: StressTestState) => void): () => void;
  run(
    assumptions: PlanAssumptions,
    allocation: PortfolioAllocation,
    volatilityAssumptions?: VolatilityAssumptions,
    events?: PlanEvent[],
  ): Promise<MonteCarloResult>;
  cancel(): void;
}

export const createMonteCarloOrchestrator = (
  workerFactory: WorkerFactory = defaultWorkerFactory,
): MonteCarloOrchestrator => {
  let state: StressTestState = { status: 'idle' };
  let worker: WorkerLike = workerFactory();
  const listeners = new Set<(state: StressTestState) => void>();
  // Rejects the promise of whichever run() call is currently in flight. Cleared once that
  // run settles so a stale response from an already-terminated worker (the terminate() call
  // itself is fire-and-forget; nothing prevents an in-flight computation from posting anyway)
  // can't reject/resolve a promise that no longer represents the current run.
  let activeReject: ((error: Error) => void) | null = null;

  const setState = (next: StressTestState) => {
    state = next;
    listeners.forEach((listener) => listener(state));
  };

  const attachHandlers = (
    target: WorkerLike,
    resolve: (result: MonteCarloResult) => void,
    reject: (error: Error) => void,
  ) => {
    target.onmessage = (event) => {
      if (activeReject !== reject) return;
      const response = event.data;
      if (response.type === 'success') {
        setState({ status: 'complete', result: response.result });
        resolve(response.result);
      } else {
        setState({ status: 'error', code: response.code, message: response.message });
        reject(new InvalidProjectionInputError(response.code, response.message));
      }
      activeReject = null;
    };
    target.onerror = (event) => {
      if (activeReject !== reject) return;
      const message = event.message || 'Monte Carlo worker crashed unexpectedly.';
      setState({ status: 'error', code: 'WORKER_CRASHED', message });
      reject(new Error(message));
      activeReject = null;
    };
  };

  const cancel = () => {
    if (state.status !== 'running') return;
    activeReject?.(new MonteCarloCancelledError());
    activeReject = null;
    worker.terminate();
    worker = workerFactory();
    setState({ status: 'cancelled' });
  };

  const run: MonteCarloOrchestrator['run'] = (assumptions, allocation, volatilityAssumptions, events = []) => {
    if (state.status === 'running') {
      cancel();
    }
    setState({ status: 'running' });
    return new Promise<MonteCarloResult>((resolve, reject) => {
      activeReject = reject;
      attachHandlers(worker, resolve, reject);
      worker.postMessage({
        assumptions,
        allocation,
        volatilityAssumptions: volatilityAssumptions ?? DEFAULT_VOLATILITY_ASSUMPTIONS,
        events,
      });
    });
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    run,
    cancel,
  };
};
