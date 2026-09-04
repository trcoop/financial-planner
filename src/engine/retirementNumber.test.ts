import { describe, expect, it } from 'vitest';

import {
  InvalidRetirementNumberInputError,
  calculateRetirementNumber,
} from './retirementNumber';
import type { RetirementNumberErrorCode, RetirementNumberInput } from './retirementNumber';

/** Default happy-path input, overridable per scenario. */
const input = (overrides: Partial<RetirementNumberInput> = {}): RetirementNumberInput => ({
  currentAge: 30,
  retirementAge: 65,
  desiredMonthlySpend: 4000,
  currentBalance: 100_000,
  annualContribution: 10_000,
  inflationRate: 0.025,
  safeWithdrawalRate: 0.04,
  annualReturnRate: 0.068,
  lifeExpectancy: 100,
  ...overrides,
});

/** Asserts `calculateRetirementNumber` throws `InvalidRetirementNumberInputError` carrying `code`. */
const expectRejection = (
  bad: RetirementNumberInput,
  code: RetirementNumberErrorCode,
): void => {
  let thrown: unknown;
  try {
    calculateRetirementNumber(bad);
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(InvalidRetirementNumberInputError);
  expect((thrown as InvalidRetirementNumberInputError).code).toBe(code);
  expect((thrown as InvalidRetirementNumberInputError).message).toBeTruthy();
};

describe('calculateRetirementNumber — target balance', () => {
  it('computes targetBalance as (desiredMonthlySpend * 12) / safeWithdrawalRate', () => {
    // 4000 * 12 = 48000; 48000 / 0.04 = 1,200,000
    const result = calculateRetirementNumber(input());
    expect(result.targetBalance).toBeCloseTo(1_200_000, 6);
  });
});

describe('calculateRetirementNumber — onTrack (short-circuit, no search)', () => {
  it('returns onTrack immediately when the requested retirementAge already clears the target', () => {
    const result = calculateRetirementNumber(
      input({
        currentAge: 30,
        retirementAge: 65,
        desiredMonthlySpend: 4000,
        currentBalance: 100_000,
        annualContribution: 10_000,
      }),
    );

    // Hand-computed via reference script: 35 years of growth-then-inflated-contribution from
    // 100,000 at 6.8% with a $10,000 (today's-dollars) annual contribution inflated at 2.5%/yr.
    expect(result.status).toBe('onTrack');
    if (result.status !== 'onTrack') throw new Error('unreachable');
    expect(result.targetBalance).toBeCloseTo(1_200_000, 6);
    expect(result.projectedBalance).toBeCloseTo(2_773_626.08, 2);
  });
});

describe('calculateRetirementNumber — shortBy (general reference scenario)', () => {
  it('reports shortBy with the hand-computed shortfall at the requested age', () => {
    const result = calculateRetirementNumber(
      input({
        currentAge: 50,
        retirementAge: 60,
        desiredMonthlySpend: 5000,
        currentBalance: 50_000,
        annualContribution: 5_000,
      }),
    );

    // target = 5000*12/0.04 = 1,500,000; 10 years of accumulation from 50,000 at 6.8% with a
    // $5,000 (today's-dollars) contribution inflated at 2.5%/yr -> proj ~= 172,186.28
    expect(result.status).toBe('shortBy');
    if (result.status !== 'shortBy') throw new Error('unreachable');
    expect(result.targetBalance).toBeCloseTo(1_500_000, 6);
    expect(result.projectedBalance).toBeCloseTo(172_186.28222708646, 2);
    expect(result.shortfallAmount).toBeCloseTo(1_327_813.7177729136, 2);
  });
});

describe('calculateRetirementNumber — couldRetireEarlier', () => {
  it('finds the earliest on-track age when it is before the requested retirementAge', () => {
    // A positive annualReturnRate with a nonnegative contribution makes projectedBalance
    // monotonically increasing in age, so if the requested retirementAge fails on-track no
    // earlier age can pass either -- couldRetireEarlier is unreachable under those
    // conditions (the requested-age check in step 1 would already have passed). A negative
    // annualReturnRate with no further contribution produces a genuinely non-monotonic
    // scenario instead: the balance is highest today and decays every year after, so the
    // requested (much later) age can fail on-track while an earlier age -- here, currentAge
    // itself -- still passes.
    const result = calculateRetirementNumber(
      input({
        currentAge: 50,
        retirementAge: 70,
        desiredMonthlySpend: 2_667,
        currentBalance: 1_000_000,
        annualContribution: 0,
        annualReturnRate: -0.02,
      }),
    );

    // target = 2667*12/0.04 = 800,100. proj@70 = 667,607.97 (fails); proj@50 (currentAge,
    // 0 years elapsed) = currentBalance = 1,000,000 (passes) -- the earliest, and only,
    // passing age in range given the monotonic decay.
    expect(result.status).toBe('couldRetireEarlier');
    if (result.status !== 'couldRetireEarlier') throw new Error('unreachable');
    expect(result.targetBalance).toBeCloseTo(800_100, 6);
    expect(result.earliestAge).toBe(50);
    expect(result.projectedBalance).toBe(1_000_000);
  });
});

describe('calculateRetirementNumber — on-track only at a later age', () => {
  it('reports shortBy at the requested age, never a false couldRetireEarlier, when the earliest passing age is after the requested age', () => {
    const result = calculateRetirementNumber(
      input({
        currentAge: 55,
        retirementAge: 60,
        desiredMonthlySpend: 3000,
        currentBalance: 80_000,
        annualContribution: 15_000,
      }),
    );

    // target = 3000*12/0.04 = 900,000. On-track fails at requested age 60 (proj ~= 201,188.88)
    // but the linear scan finds age 74 on-track within [55, 100] — must still be shortBy at 60.
    expect(result.status).toBe('shortBy');
    if (result.status !== 'shortBy') throw new Error('unreachable');
    expect(result.targetBalance).toBeCloseTo(900_000, 6);
    expect(result.projectedBalance).toBeCloseTo(201_188.88001960047, 2);
    expect(result.shortfallAmount).toBeCloseTo(900_000 - 201_188.88001960047, 2);
  });
});

describe('calculateRetirementNumber — no on-track age anywhere in range', () => {
  it('falls back to shortBy at the requested age when nothing in [currentAge, lifeExpectancy] passes', () => {
    const result = calculateRetirementNumber(
      input({
        currentAge: 60,
        retirementAge: 65,
        desiredMonthlySpend: 10_000,
        currentBalance: 20_000,
        annualContribution: 2_000,
        lifeExpectancy: 100,
      }),
    );

    // target = 10000*12/0.04 = 3,000,000 — never reachable in this scenario within the range.
    expect(result.status).toBe('shortBy');
    if (result.status !== 'shortBy') throw new Error('unreachable');
    expect(result.targetBalance).toBeCloseTo(3_000_000, 6);
    expect(result.projectedBalance).toBeCloseTo(39_793.782356873366, 2);
  });
});

describe('calculateRetirementNumber — already-retired input (retirementAge === currentAge)', () => {
  it('computes a valid year-0 result with a non-empty search range', () => {
    const result = calculateRetirementNumber(
      input({
        currentAge: 65,
        retirementAge: 65,
        desiredMonthlySpend: 4000,
        currentBalance: 1_000_000,
        annualContribution: 0,
      }),
    );

    // 0 years elapsed -> projectedBalance === currentBalance exactly.
    expect(result.status).toBe('shortBy');
    if (result.status !== 'shortBy') throw new Error('unreachable');
    expect(result.targetBalance).toBeCloseTo(1_200_000, 6);
    expect(result.projectedBalance).toBe(1_000_000);
    expect(result.shortfallAmount).toBeCloseTo(200_000, 6);
  });
});

describe('calculateRetirementNumber — annualContribution inflation adjustment (regression)', () => {
  it('inflates annualContribution each accumulation year rather than holding it flat-nominal, changing the on-track result', () => {
    const params = {
      currentAge: 25,
      retirementAge: 65,
      currentBalance: 5_000,
      annualContribution: 6_000,
      inflationRate: 0.025,
      safeWithdrawalRate: 0.04,
      annualReturnRate: 0.068,
      lifeExpectancy: 100,
    };
    // With annualContribution inflation-adjusted (spec-correct): projectedBalance ~= 1,633,613.09
    // With annualContribution held flat-nominal (the bug this regression test guards against):
    // projectedBalance ~= 1,207,243.93
    // desiredMonthlySpend of 4,730 puts targetBalance (1,419,000) strictly between the two,
    // so the two implementations disagree on-track/short-by for the same inputs.
    const result = calculateRetirementNumber(input({ ...params, desiredMonthlySpend: 4_730 }));

    expect(result.status).toBe('onTrack');
    if (result.status !== 'onTrack') throw new Error('unreachable');
    expect(result.targetBalance).toBeCloseTo(1_419_000, 6);
    expect(result.projectedBalance).toBeCloseTo(1_633_613.0942569003, 2);
  });
});

describe('calculateRetirementNumber — validation errors', () => {
  it('NON_FINITE_INPUT: rejects a non-finite currentAge', () => {
    expectRejection(input({ currentAge: NaN }), 'NON_FINITE_INPUT');
  });

  it('NON_FINITE_INPUT: rejects a non-finite desiredMonthlySpend', () => {
    expectRejection(input({ desiredMonthlySpend: Infinity }), 'NON_FINITE_INPUT');
  });

  it('NEGATIVE_AMOUNT: rejects a negative desiredMonthlySpend', () => {
    expectRejection(input({ desiredMonthlySpend: -100 }), 'NEGATIVE_AMOUNT');
  });

  it('NEGATIVE_AMOUNT: rejects a negative currentBalance', () => {
    expectRejection(input({ currentBalance: -1 }), 'NEGATIVE_AMOUNT');
  });

  it('NEGATIVE_AMOUNT: rejects a negative annualContribution', () => {
    expectRejection(input({ annualContribution: -1 }), 'NEGATIVE_AMOUNT');
  });

  it('RETIREMENT_AGE_NOT_AFTER_CURRENT_AGE: rejects retirementAge < currentAge', () => {
    expectRejection(
      input({ currentAge: 50, retirementAge: 49 }),
      'RETIREMENT_AGE_NOT_AFTER_CURRENT_AGE',
    );
  });

  it('RETIREMENT_AGE_NOT_AFTER_CURRENT_AGE: does not reject retirementAge === currentAge', () => {
    expect(() => calculateRetirementNumber(input({ currentAge: 50, retirementAge: 50 }))).not.toThrow();
  });

  it('LIFE_EXPECTANCY_BEFORE_RETIREMENT_AGE: rejects lifeExpectancy < retirementAge', () => {
    expectRejection(
      input({ retirementAge: 65, lifeExpectancy: 64 }),
      'LIFE_EXPECTANCY_BEFORE_RETIREMENT_AGE',
    );
  });

  it('SAFE_WITHDRAWAL_RATE_OUT_OF_RANGE: rejects safeWithdrawalRate <= 0', () => {
    expectRejection(input({ safeWithdrawalRate: 0 }), 'SAFE_WITHDRAWAL_RATE_OUT_OF_RANGE');
  });

  it('SAFE_WITHDRAWAL_RATE_OUT_OF_RANGE: rejects safeWithdrawalRate > 1', () => {
    expectRejection(input({ safeWithdrawalRate: 1.5 }), 'SAFE_WITHDRAWAL_RATE_OUT_OF_RANGE');
  });

  it('RATE_BELOW_NEGATIVE_100_PERCENT: rejects inflationRate < -1', () => {
    expectRejection(input({ inflationRate: -1.1 }), 'RATE_BELOW_NEGATIVE_100_PERCENT');
  });

  it('RATE_BELOW_NEGATIVE_100_PERCENT: rejects annualReturnRate < -1', () => {
    expectRejection(input({ annualReturnRate: -1.1 }), 'RATE_BELOW_NEGATIVE_100_PERCENT');
  });
});

describe('calculateRetirementNumber — defaults', () => {
  it('applies documented defaults when optional rate/horizon fields are omitted', () => {
    const minimalInput: RetirementNumberInput = {
      currentAge: 30,
      retirementAge: 65,
      desiredMonthlySpend: 4000,
      currentBalance: 100_000,
      annualContribution: 10_000,
    } as RetirementNumberInput;

    const withDefaults = calculateRetirementNumber(minimalInput);
    const withExplicitDefaults = calculateRetirementNumber(
      input({
        currentAge: 30,
        retirementAge: 65,
        desiredMonthlySpend: 4000,
        currentBalance: 100_000,
        annualContribution: 10_000,
        inflationRate: 0.025,
        safeWithdrawalRate: 0.04,
        annualReturnRate: 0.068,
        lifeExpectancy: 100,
      }),
    );

    expect(withDefaults).toEqual(withExplicitDefaults);
  });
});
