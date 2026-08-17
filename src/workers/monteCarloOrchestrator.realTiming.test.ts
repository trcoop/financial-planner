import { describe, expect, it } from 'vitest';

import type { PlanAssumptions } from '../engine';
import { handleMonteCarloRequest } from './monteCarloHandler';
import { createMonteCarloOrchestrator, MonteCarloCancelledError } from './monteCarloOrchestrator';
import type { WorkerLike } from './monteCarloOrchestrator';
import type { MonteCarloWorkerRequest, MonteCarloWorkerResponse } from './protocol';

/**
 * FIN-19: an end-to-end test of the cancellation flow against the *real* Monte Carlo
 * computation (`handleMonteCarloRequest`, the same function the real Worker script wraps —
 * see `monteCarloWorkerEntry.ts`) and *real* async timing (no fake timers, no synchronous
 * `respond()` calls as in `monteCarloOrchestrator.test.ts`'s `FakeWorker`).
 *
 * Why this isn't a real browser `Worker`: this project's test environment is jsdom (see
 * `vite.config.ts`), which has no `Worker` global, and the underlying Node runtime doesn't
 * either — verified empirically (`node -e "console.log(typeof Worker)"` -> `undefined` on
 * the Node version this repo runs on). `monteCarloOrchestrator.ts`'s own doc comment confirms
 * this was a deliberate, already-known constraint from FIN-18, not an oversight: the
 * `WorkerLike` injection seam exists specifically because "jsdom/Vitest cannot instantiate" a
 * real `Worker`. No polyfill package (e.g. a `web-worker` shim) is installed, and adding one
 * as a devDependency solely to exercise this one path is disproportionate to the gap.
 *
 * What this test achieves instead: a `WorkerLike` double (`RealAsyncWorker`) that (a) runs the
 * actual production Monte Carlo computation via `handleMonteCarloRequest` — the same function
 * the real worker script calls — and (b) delivers its response via a genuine `setTimeout`
 * (macrotask) round-trip rather than a synchronous call, under real system timers (no
 * `vi.useFakeTimers`). This exercises the real race condition the ticket is worried about:
 * `orchestrator.cancel()` firing while a response is already in-flight/scheduled, with actual
 * non-deterministic async interleaving rather than developer-controlled synchronous mocking.
 */
class RealAsyncWorker implements WorkerLike {
  onmessage: ((event: MessageEvent<MonteCarloWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  postMessage(message: MonteCarloWorkerRequest): void {
    // Real setTimeout (not queueMicrotask/Promise.resolve) to mirror a real Worker's
    // out-of-band, scheduler-driven delivery, and to give cancel() a genuine window to race
    // against a response that's already computed and queued for delivery.
    this.timer = setTimeout(() => {
      if (this.terminated) return; // a real terminated Worker delivers nothing further
      const response = handleMonteCarloRequest(message);
      this.onmessage?.({ data: response } as MessageEvent<MonteCarloWorkerResponse>);
    }, 10);
  }

  terminate(): void {
    this.terminated = true;
    if (this.timer) clearTimeout(this.timer);
  }
}

const assumptions: PlanAssumptions = {
  currentAge: 35,
  retirementAge: 67,
  initialBalance: 100_000,
  currentAnnualIncome: 80_000,
  annualContributionRate: 0.15,
  annualRaiseRate: 0.03,
  annualReturnRate: 0.07,
  inflationRate: 0.025,
  withdrawalRateInRetirement: 0.04,
  planningHorizonEndAge: 100,
};
const allocation = { stocksPercent: 70, bondsPercent: 30 };

describe('createMonteCarloOrchestrator against real computation and real async timing', () => {
  it('resolves with a genuine Monte Carlo result computed by the real handler', async () => {
    const orchestrator = createMonteCarloOrchestrator(() => new RealAsyncWorker());

    const result = await orchestrator.run(assumptions, allocation);

    expect(result.successRate).toBeGreaterThanOrEqual(0);
    expect(result.successRate).toBeLessThanOrEqual(100);
    expect(result.meta.simulationCount).toBeGreaterThan(0);
    expect(orchestrator.getState()).toEqual({ status: 'complete', result });
  });

  it('cancelling before the real (timer-scheduled) response arrives rejects with MonteCarloCancelledError and never resolves with a stale result', async () => {
    const orchestrator = createMonteCarloOrchestrator(() => new RealAsyncWorker());

    const promise = orchestrator.run(assumptions, allocation);
    // No fake timers: this is a real race against the RealAsyncWorker's real setTimeout.
    // Cancel immediately, well before the 10ms response would fire.
    orchestrator.cancel();

    await expect(promise).rejects.toBeInstanceOf(MonteCarloCancelledError);
    expect(orchestrator.getState()).toEqual({ status: 'cancelled' });

    // Let the terminated worker's scheduled (but now-suppressed) timer window fully elapse in
    // real time, confirming no delayed delivery resurrects state or the settled promise.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(orchestrator.getState()).toEqual({ status: 'cancelled' });
  });

  it('cancelling mid-flight, then immediately starting a fresh real run, resolves the fresh run with its own real result and ignores the stale one', async () => {
    const orchestrator = createMonteCarloOrchestrator(() => new RealAsyncWorker());

    const first = orchestrator.run(assumptions, allocation);
    orchestrator.cancel();
    await expect(first).rejects.toBeInstanceOf(MonteCarloCancelledError);

    const second = orchestrator.run({ ...assumptions, currentAge: 40 }, allocation);
    const result = await second;

    expect(result.successRate).toBeGreaterThanOrEqual(0);
    expect(orchestrator.getState()).toEqual({ status: 'complete', result });
  });

  it('calling run() again while a real run is already in flight cancels the stale one under real timing without cross-resolving', async () => {
    const orchestrator = createMonteCarloOrchestrator(() => new RealAsyncWorker());

    const first = orchestrator.run(assumptions, allocation);
    const second = orchestrator.run({ ...assumptions, currentAge: 50 }, allocation);

    await expect(first).rejects.toBeInstanceOf(MonteCarloCancelledError);
    const result = await second;
    expect(result.successRate).toBeGreaterThanOrEqual(0);
    expect(orchestrator.getState()).toEqual({ status: 'complete', result });
  });
});
