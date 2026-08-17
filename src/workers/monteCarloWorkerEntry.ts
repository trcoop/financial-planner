/**
 * The actual Worker script (ERD §3, §7) — instantiated by `monteCarloOrchestrator.ts`'s
 * default worker factory via
 * `new Worker(new URL('./monteCarloWorkerEntry.ts', import.meta.url), { type: 'module' })`.
 *
 * Only ever runs inside a real browser Worker; never imported by tests, which exercise
 * `handleMonteCarloRequest` directly instead. `self` is cast to a minimal local shape rather
 * than typed against the `webworker` lib: `webworker` and this project's `dom` lib (needed for
 * React/the orchestrator) declare conflicting globals and cannot both be included in one
 * tsconfig.
 */

import { handleMonteCarloRequest } from './monteCarloHandler';
import type { MonteCarloWorkerRequest } from './protocol';

const workerSelf = self as unknown as {
  onmessage: ((event: MessageEvent<MonteCarloWorkerRequest>) => void) | null;
  postMessage: (message: unknown) => void;
};

workerSelf.onmessage = (event) => {
  workerSelf.postMessage(handleMonteCarloRequest(event.data));
};
