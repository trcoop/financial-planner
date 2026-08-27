import { describe, expect, it, vi } from 'vitest';

import { InvalidProjectionInputError, runMonteCarloTrials } from '../engine';
import type { PlanAssumptions } from '../engine';
import { handleMonteCarloRequest } from './monteCarloHandler';
import type { MonteCarloWorkerRequest } from './protocol';

// Delegates to the real implementation by default; individual tests override it to inject
// failure modes (e.g. a non-InvalidProjectionInputError throw) that the real engine won't
// otherwise produce.
vi.mock('../engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../engine')>();
  return { ...actual, runMonteCarloTrials: vi.fn(actual.runMonteCarloTrials) };
});

const assumptions = (overrides: Partial<PlanAssumptions> = {}): PlanAssumptions => ({
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
  ...overrides,
});

const validRequest = (overrides: Partial<MonteCarloWorkerRequest> = {}): MonteCarloWorkerRequest => ({
  assumptions: assumptions(),
  allocation: { stocksPercent: 70, bondsPercent: 30 },
  volatilityAssumptions: { stocks: 0.15, bonds: 0.06 },
  events: [],
  returnAssumptions: { stocks: 0.07, bonds: 0.045 },
  ...overrides,
});

describe('handleMonteCarloRequest', () => {
  it('returns a success payload wrapping the same result runMonteCarloTrials would produce', () => {
    const request = validRequest();

    const response = handleMonteCarloRequest(request);

    expect(response.type).toBe('success');
    if (response.type !== 'success') throw new Error('expected success');
    const directly = runMonteCarloTrials(
      request.assumptions,
      request.allocation,
      request.volatilityAssumptions,
      request.events,
      { returnAssumptions: request.returnAssumptions },
    );
    // Both calls draw a fresh random seed, so compare shape/meta rather than exact values.
    expect(response.result.meta).toEqual(directly.meta);
    expect(response.result.percentiles.real.p10).toHaveLength(66);
    expect(response.result.percentiles.nominal.p10).toHaveLength(66);
    expect(response.result.successRate).toBeGreaterThanOrEqual(0);
    expect(response.result.successRate).toBeLessThanOrEqual(100);
  });

  it('converts a thrown InvalidProjectionInputError into a structured-clone-safe error payload', () => {
    const request = validRequest({ allocation: { stocksPercent: 70, bondsPercent: 25 } });

    const response = handleMonteCarloRequest(request);

    expect(response).toEqual({
      type: 'error',
      code: 'ALLOCATION_SUM_INVALID',
      message: expect.stringContaining('must sum to 100'),
    });
  });

  it('the error payload carries the exact code needed to reconstruct a real InvalidProjectionInputError', () => {
    const request = validRequest({ assumptions: assumptions({ currentAge: 150 }) });

    const response = handleMonteCarloRequest(request);

    expect(response.type).toBe('error');
    if (response.type !== 'error') throw new Error('expected error');
    const reconstructed = new InvalidProjectionInputError(response.code, response.message);
    expect(reconstructed).toBeInstanceOf(InvalidProjectionInputError);
    expect(reconstructed.code).toBe('CURRENT_AGE_EXCEEDS_HORIZON');
  });

  it('threads the request returnAssumptions through to runMonteCarloTrials (FIN-57)', () => {
    const returnAssumptions = { stocks: 0.07, bonds: 0.06 };
    const request = validRequest({ returnAssumptions });

    handleMonteCarloRequest(request);

    expect(runMonteCarloTrials).toHaveBeenLastCalledWith(
      request.assumptions,
      request.allocation,
      request.volatilityAssumptions,
      request.events,
      { returnAssumptions },
    );
  });

  it('propagates a non-InvalidProjectionInputError throw uncaught rather than misreporting it as a validation failure', () => {
    vi.mocked(runMonteCarloTrials).mockImplementationOnce(() => {
      throw new TypeError('engine bug unrelated to caller input');
    });

    expect(() => handleMonteCarloRequest(validRequest())).toThrow(TypeError);
  });
});
