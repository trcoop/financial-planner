import { describe, expect, it, vi } from 'vitest';

import { InvalidProjectionInputError } from '../engine';
import type { MonteCarloResult, PlanAssumptions } from '../engine';
import {
  createMonteCarloOrchestrator,
  MonteCarloCancelledError,
} from './monteCarloOrchestrator';
import type { WorkerLike } from './monteCarloOrchestrator';
import type { MonteCarloWorkerRequest, MonteCarloWorkerResponse } from './protocol';

/**
 * A fully manually-controlled stand-in for a real `Worker`. Real workers respond
 * asynchronously and unpredictably; this lets tests dictate exactly when (or whether) a
 * response arrives, which is what makes race conditions like "cancel before the worker
 * replies" actually testable.
 */
class FakeWorker implements WorkerLike {
  posted: MonteCarloWorkerRequest[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<MonteCarloWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  postMessage(message: MonteCarloWorkerRequest): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(response: MonteCarloWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<MonteCarloWorkerResponse>);
  }

  crash(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
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

const fakeResult: MonteCarloResult = {
  successRate: 87,
  percentiles: { p10: [1], p50: [2], p90: [3] },
  meta: { simulationCount: 1000, stockVolatility: 0.15, bondVolatility: 0.06, allocation: { stocks: 70, bonds: 30 } },
};

/** A workerFactory that hands out FakeWorkers in creation order, for inspection by the test. */
const fakeFactory = () => {
  const workers: FakeWorker[] = [];
  const factory = () => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  };
  return { factory, workers };
};

describe('createMonteCarloOrchestrator', () => {
  it('starts idle', () => {
    const { factory } = fakeFactory();
    const orchestrator = createMonteCarloOrchestrator(factory);

    expect(orchestrator.getState()).toEqual({ status: 'idle' });
  });

  it('transitions idle -> running -> complete and resolves with the worker\'s result', async () => {
    const { factory, workers } = fakeFactory();
    const orchestrator = createMonteCarloOrchestrator(factory);

    const promise = orchestrator.run(assumptions, allocation);
    expect(orchestrator.getState()).toEqual({ status: 'running' });

    workers[0].respond({ type: 'success', result: fakeResult });

    await expect(promise).resolves.toEqual(fakeResult);
    expect(orchestrator.getState()).toEqual({ status: 'complete', result: fakeResult });
  });

  it('posts the assumptions/allocation/volatility/events/returns exactly as given, defaulting volatility, events and returns', () => {
    const { factory, workers } = fakeFactory();
    const orchestrator = createMonteCarloOrchestrator(factory);

    orchestrator.run(assumptions, allocation);

    expect(workers[0].posted).toEqual([
      {
        assumptions,
        allocation,
        volatilityAssumptions: { stocks: 0.195, bonds: 0.077 },
        events: [],
        returnAssumptions: { stocks: 0.115, bonds: 0.05 },
      },
    ]);
  });

  it('passes through explicit volatility and events unchanged', () => {
    const { factory, workers } = fakeFactory();
    const orchestrator = createMonteCarloOrchestrator(factory);
    const volatility = { stocks: 0.2, bonds: 0.1 };
    const events = [{ type: 'oneTimeExpense' as const, atAge: 50, amount: 1000, label: 'roof' }];

    orchestrator.run(assumptions, allocation, volatility, events);

    expect(workers[0].posted[0]).toEqual({
      assumptions,
      allocation,
      volatilityAssumptions: volatility,
      events,
      returnAssumptions: { stocks: 0.115, bonds: 0.05 },
    });
  });

  it('passes through an explicit returnAssumptions unchanged (FIN-57)', () => {
    const { factory, workers } = fakeFactory();
    const orchestrator = createMonteCarloOrchestrator(factory);
    const returnAssumptions = { stocks: 0.07, bonds: 0.055 };

    orchestrator.run(assumptions, allocation, undefined, undefined, returnAssumptions);

    expect(workers[0].posted[0]).toEqual({
      assumptions,
      allocation,
      volatilityAssumptions: { stocks: 0.195, bonds: 0.077 },
      events: [],
      returnAssumptions,
    });
  });

  it('reconstructs a real InvalidProjectionInputError from the worker\'s error payload and rejects', async () => {
    const { factory, workers } = fakeFactory();
    const orchestrator = createMonteCarloOrchestrator(factory);

    const promise = orchestrator.run(assumptions, allocation);
    workers[0].respond({ type: 'error', code: 'ALLOCATION_SUM_INVALID', message: 'bad allocation' });

    await expect(promise).rejects.toBeInstanceOf(InvalidProjectionInputError);
    await promise.catch((error: InvalidProjectionInputError) => {
      expect(error.code).toBe('ALLOCATION_SUM_INVALID');
      expect(error.message).toBe('bad allocation');
    });
    expect(orchestrator.getState()).toEqual({
      status: 'error',
      code: 'ALLOCATION_SUM_INVALID',
      message: 'bad allocation',
    });
  });

  it('transitions to error and rejects if the worker itself crashes', async () => {
    const { factory, workers } = fakeFactory();
    const orchestrator = createMonteCarloOrchestrator(factory);

    const promise = orchestrator.run(assumptions, allocation);
    workers[0].crash('boom');

    await expect(promise).rejects.toThrow('boom');
    expect(orchestrator.getState()).toEqual({ status: 'error', code: 'WORKER_CRASHED', message: 'boom' });
  });

  it('cancel() while running terminates the worker, spins up a fresh one, and transitions to cancelled', async () => {
    const { factory, workers } = fakeFactory();
    const orchestrator = createMonteCarloOrchestrator(factory);

    const promise = orchestrator.run(assumptions, allocation);
    orchestrator.cancel();

    expect(workers[0].terminated).toBe(true);
    expect(workers).toHaveLength(2);
    expect(orchestrator.getState()).toEqual({ status: 'cancelled' });
    await expect(promise).rejects.toBeInstanceOf(MonteCarloCancelledError);
  });

  it('a stale response from a cancelled run\'s terminated worker does not resurrect its promise or state', async () => {
    const { factory, workers } = fakeFactory();
    const orchestrator = createMonteCarloOrchestrator(factory);

    const promise = orchestrator.run(assumptions, allocation);
    orchestrator.cancel();
    // Simulate the terminated worker's in-flight computation finishing anyway, before the
    // real `terminate()` call (opaque here, since FakeWorker doesn't model it) takes effect.
    workers[0].respond({ type: 'success', result: fakeResult });

    expect(orchestrator.getState()).toEqual({ status: 'cancelled' });
    await expect(promise).rejects.toBeInstanceOf(MonteCarloCancelledError);
  });

  it('a stale crash from a cancelled run\'s terminated worker does not disturb state or reject an already-settled promise', async () => {
    const { factory, workers } = fakeFactory();
    const orchestrator = createMonteCarloOrchestrator(factory);

    const promise = orchestrator.run(assumptions, allocation);
    orchestrator.cancel();
    // Mirrors the stale-`respond` case above but for the worker-crash path: the terminated
    // worker's onerror can still fire after cancel() has already settled the promise.
    workers[0].crash('stale crash');

    expect(orchestrator.getState()).toEqual({ status: 'cancelled' });
    await expect(promise).rejects.toBeInstanceOf(MonteCarloCancelledError);
  });

  it('cancel() is a no-op when not running', () => {
    const { factory, workers } = fakeFactory();
    const orchestrator = createMonteCarloOrchestrator(factory);

    orchestrator.cancel();

    expect(workers).toHaveLength(1);
    expect(workers[0].terminated).toBe(false);
    expect(orchestrator.getState()).toEqual({ status: 'idle' });
  });

  it('does not auto-restart or queue after cancellation: a fresh run() is required', async () => {
    const { factory, workers } = fakeFactory();
    const orchestrator = createMonteCarloOrchestrator(factory);

    const promise = orchestrator.run(assumptions, allocation);
    orchestrator.cancel();
    await expect(promise).rejects.toBeInstanceOf(MonteCarloCancelledError);

    expect(orchestrator.getState()).toEqual({ status: 'cancelled' });
    // No further worker was spun up beyond the single respawn cancel() itself performs.
    expect(workers).toHaveLength(2);
    expect(workers[1].posted).toHaveLength(0);
  });

  it('a later run() after cancellation resolving does not disturb an already-resolved earlier result held by the caller', async () => {
    const { factory, workers } = fakeFactory();
    const orchestrator = createMonteCarloOrchestrator(factory);

    const first = orchestrator.run(assumptions, allocation);
    workers[0].respond({ type: 'success', result: fakeResult });
    const firstResult = await first;

    const second = orchestrator.run(assumptions, allocation);
    orchestrator.cancel();
    await expect(second).rejects.toBeInstanceOf(MonteCarloCancelledError);

    // The caller's own reference to the first run's resolved value is untouched — retaining
    // "previously completed results" on screen through a later cancellation is the UI's job
    // (it holds this value itself), not something the orchestrator's StressTestState can
    // express, since `cancelled` carries no result field (ERD §7).
    expect(firstResult).toEqual(fakeResult);
  });

  it('calling run() while already running cancels the stale run first rather than racing two responses', async () => {
    const { factory, workers } = fakeFactory();
    const orchestrator = createMonteCarloOrchestrator(factory);

    const first = orchestrator.run(assumptions, allocation);
    const second = orchestrator.run(assumptions, allocation);

    expect(workers[0].terminated).toBe(true);
    await expect(first).rejects.toBeInstanceOf(MonteCarloCancelledError);

    workers[1].respond({ type: 'success', result: fakeResult });
    await expect(second).resolves.toEqual(fakeResult);
  });

  it('notifies subscribers of every state transition and stops after unsubscribe', () => {
    const { factory, workers } = fakeFactory();
    const orchestrator = createMonteCarloOrchestrator(factory);
    const listener = vi.fn();

    const unsubscribe = orchestrator.subscribe(listener);
    orchestrator.run(assumptions, allocation);
    workers[0].respond({ type: 'success', result: fakeResult });

    expect(listener.mock.calls.map((call) => call[0])).toEqual([
      { status: 'running' },
      { status: 'complete', result: fakeResult },
    ]);

    unsubscribe();
    orchestrator.run(assumptions, allocation);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
