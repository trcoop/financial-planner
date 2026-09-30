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

describe('SS_ error codes (FIN-160)', () => {
  const SS_CODES = [
    'SS_NEGATIVE_BENEFIT',
    'SS_INVALID_BIRTH',
    'SS_UNSUPPORTED_BIRTH_YEAR',
    'SS_INVALID_AS_OF',
    'SS_CLAIM_BEFORE_ELIGIBLE',
    'SS_CLAIM_AFTER_70',
    'SS_CLAIM_IN_PAST',
    'SS_INVALID_ALREADY_COLLECTING',
    'SS_INVALID_COLA',
    'SS_INVALID_GROWTH_RATE',
    'SS_INVALID_DEATH',
    'SS_SPOUSAL_INPUT_ON_SINGLE',
    'SS_INVALID_CLAIM_AXES',
    'SS_INVALID_TOP_N',
    'SS_NOT_IMPLEMENTED',
  ] as const;

  it.each(SS_CODES)('%s is a valid ProjectionErrorCode carried by the error class', (code) => {
    const error = new InvalidProjectionInputError(code, 'x');
    expect(error.code).toBe(code);
  });
});
