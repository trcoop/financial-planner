import { describe, expect, it } from 'vitest';

import { InvalidProjectionInputError } from './errors';

describe('InvalidProjectionInputError', () => {
  it('is an Error subclass', () => {
    const error = new InvalidProjectionInputError(
      'CURRENT_AGE_EXCEEDS_HORIZON',
      'currentAge (105) exceeds planningHorizonEndAge (100)',
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(InvalidProjectionInputError);
  });

  it('exposes the stable code passed to it', () => {
    const error = new InvalidProjectionInputError('NON_FINITE_INPUT', 'annualReturnRate is NaN');

    expect(error.code).toBe('NON_FINITE_INPUT');
  });

  it('exposes the human-readable message passed to it', () => {
    const error = new InvalidProjectionInputError('NEGATIVE_AGE', 'currentAge must not be negative');

    expect(error.message).toBe('currentAge must not be negative');
  });

  it('reports its own name rather than the base Error name', () => {
    const error = new InvalidProjectionInputError('NEGATIVE_INCOME', 'currentAnnualIncome must not be negative');

    expect(error.name).toBe('InvalidProjectionInputError');
  });

  it('is catchable as its own type after being thrown', () => {
    const thrower = () => {
      throw new InvalidProjectionInputError('WITHDRAWAL_RATE_OUT_OF_RANGE', 'withdrawalRateInRetirement must be 0-1');
    };

    expect(thrower).toThrow(InvalidProjectionInputError);
    expect(thrower).toThrow('withdrawalRateInRetirement must be 0-1');
  });
});
