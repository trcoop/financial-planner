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
  it('computes targetBalance as (desiredMonthlySpend * 12) / safeWithdrawalRate inflated forward to retirementAge', () => {
    // today's-dollars target: 4000 * 12 = 48000; 48000 / 0.04 = 1,200,000. The returned
    // targetBalance is that figure inflated by (1.025)^35 (35 years from currentAge 30 to
    // retirementAge 65) = 1,200,000 * 2.373205... ~= 2,847,846.22, since "Your number" is
    // the dollar amount actually needed at the requested retirement age, not today's-dollars.
    const result = calculateRetirementNumber(input());
    expect(result.targetBalance).toBeCloseTo(2_847_846.22, 2);
  });
});

describe('calculateRetirementNumber — onTrack', () => {
  it('reports onTrack when the inflated target is first reached exactly at the requested retirementAge', () => {
    // desiredMonthlySpend is hand-picked (via reference script) so that the today's-dollars
    // target, inflated by (1.025)^35 to age 65, exactly equals the projected balance at 65
    // (~2,773,626.08 -- 35 years of growth-then-inflated-contribution from 100,000 at 6.8%
    // with a $10,000 today's-dollars contribution inflated at 2.5%/yr). Age 64's balance
    // (~2,575,349.11) is still short of age 64's own inflated target (~2,705,976.66), so age
    // 65 is genuinely the earliest on-track age under the apples-to-apples comparison.
    const result = calculateRetirementNumber(
      input({
        currentAge: 30,
        retirementAge: 65,
        desiredMonthlySpend: 3_895.752590667486,
        currentBalance: 100_000,
        annualContribution: 10_000,
      }),
    );

    expect(result.status).toBe('onTrack');
    if (result.status !== 'onTrack') throw new Error('unreachable');
    expect(result.targetBalance).toBeCloseTo(2_773_626.08, 2);
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

    // today's-dollars target = 5000*12/0.04 = 1,500,000, inflated by (1.025)^10 to age 60 ->
    // ~= 1,920,126.82; 10 years of accumulation from 50,000 at 6.8% with a $5,000
    // (today's-dollars) contribution inflated at 2.5%/yr -> proj ~= 172,186.28
    expect(result.status).toBe('shortBy');
    if (result.status !== 'shortBy') throw new Error('unreachable');
    expect(result.targetBalance).toBeCloseTo(1_920_126.82, 2);
    expect(result.projectedBalance).toBeCloseTo(172_186.28222708646, 2);
    expect(result.shortfallAmount).toBeCloseTo(1_747_940.53, 2);
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

    // today's-dollars target = 2667*12/0.04 = 800,100, inflated by (1.025)^20 to age 70 ->
    // ~= 1,311,057.01 (the returned targetBalance). At currentAge=50 (0 years elapsed) the
    // year-0 inflated target equals the today's-dollars figure exactly (800,100), and
    // currentBalance = 1,000,000 clears it -- the earliest, and only, passing age in range
    // given the monotonic decay. `projectedBalance` is still the balance at the *requested*
    // retirementAge (70), not at earliestAge (50).
    expect(result.status).toBe('couldRetireEarlier');
    if (result.status !== 'couldRetireEarlier') throw new Error('unreachable');
    expect(result.targetBalance).toBeCloseTo(1_311_057.01, 2);
    expect(result.earliestAge).toBe(50);
    expect(result.projectedBalance).toBeCloseTo(667_607.9717550945, 6);
  });

  it('finds an earlier on-track age even when the requested retirementAge itself is already on-track (monotonic growth)', () => {
    // With a positive annualReturnRate and a healthy contribution, projectedBalance grows
    // monotonically with age, so the requested retirementAge (65) clears the target too --
    // but the household actually hits the target years earlier, at age 40. The old
    // "check retirementAge first, only search on failure" logic would have short-circuited
    // to `onTrack` here without ever discovering the earlier age -- this is the scenario
    // that was truly unreachable before the fix (as opposed to the decay scenario above,
    // which the old forward-from-currentAge search could already stumble into).
    const result = calculateRetirementNumber(
      input({
        currentAge: 30,
        retirementAge: 65,
        desiredMonthlySpend: 2_000,
        currentBalance: 0,
        annualContribution: 40_000,
      }),
    );

    // today's-dollars target = 2000*12/0.04 = 600,000, inflated by (1.025)^35 to age 65 ->
    // ~= 1,423,923.11 (the returned targetBalance). Balance now crosses its own year's
    // inflated target at age 43 (not 40 as under the old, static-target comparison), since
    // the bar it must clear keeps rising with inflation each year.
    expect(result.status).toBe('couldRetireEarlier');
    if (result.status !== 'couldRetireEarlier') throw new Error('unreachable');
    expect(result.targetBalance).toBeCloseTo(1_423_923.11, 2);
    expect(result.earliestAge).toBe(43);
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

    // today's-dollars target = 3000*12/0.04 = 900,000, inflated by (1.025)^5 to age 60 ->
    // ~= 1,018,267.39 (the returned targetBalance). On-track fails at requested age 60
    // (proj ~= 201,188.88) but the linear scan finds age 82 on-track within [55, 100] against
    // its own year's ever-rising inflated target — must still be shortBy at 60.
    expect(result.status).toBe('shortBy');
    if (result.status !== 'shortBy') throw new Error('unreachable');
    expect(result.targetBalance).toBeCloseTo(1_018_267.39, 2);
    expect(result.projectedBalance).toBeCloseTo(201_188.88001960047, 2);
    expect(result.shortfallAmount).toBeCloseTo(1_018_267.39 - 201_188.88001960047, 2);
    expect(result.onTrackAge).toBe(82);
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

    // today's-dollars target = 10000*12/0.04 = 3,000,000, inflated by (1.025)^5 to age 65 ->
    // ~= 3,394,224.64 (the returned targetBalance) — never reachable in this scenario within
    // the range, since the balance decays relative to its own year's ever-rising target.
    expect(result.status).toBe('shortBy');
    if (result.status !== 'shortBy') throw new Error('unreachable');
    expect(result.targetBalance).toBeCloseTo(3_394_224.64, 2);
    expect(result.projectedBalance).toBeCloseTo(39_793.782356873366, 2);
    expect(result.onTrackAge).toBeUndefined();
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
    // With the target-balance-inflation fix, the today's-dollars target (1,600,000) is now
    // inflated by (1.025)^40 to age 65 -> ~= 4,296,099.46, which the inflation-adjusted
    // balance no longer reaches by 65 (earliest on-track age is 86 instead) -- confirming the
    // fix requires MORE saved / a LATER age than the old static-target comparison, which
    // reported onTrack here.
    const result = calculateRetirementNumber(input({ ...params, desiredMonthlySpend: 5_333.33 }));

    expect(result.status).toBe('shortBy');
    if (result.status !== 'shortBy') throw new Error('unreachable');
    expect(result.targetBalance).toBeCloseTo(4_296_099.46, 2);
    expect(result.projectedBalance).toBeCloseTo(1_633_613.0942569003, 2);
  });
});

describe('calculateRetirementNumber — target-balance inflation (regression)', () => {
  it('requires MORE saved / a LATER on-track age than a static, un-inflated target would', () => {
    // Same inputs as the base scenario (30 -> 65, $4,000/mo, $100,000 starting, $10,000/yr
    // contribution). The OLD (buggy) logic compared the running nominal balance against a
    // flat today's-dollars targetBalance (desiredMonthlySpend*12/safeWithdrawalRate =
    // 1,200,000) computed once and never inflated -- so it would report onTrack/
    // couldRetireEarlier as soon as the nominal balance first crossed 1,200,000.
    const scenario = input({
      currentAge: 30,
      retirementAge: 65,
      desiredMonthlySpend: 4_000,
      currentBalance: 100_000,
      annualContribution: 10_000,
    });
    const staticTargetBalance = (scenario.desiredMonthlySpend * 12) / (scenario.safeWithdrawalRate ?? 0.04);

    // Reconstruct the OLD, buggy earliest-on-track age: first age whose nominal balance
    // (same growth/contribution trajectory this engine computes) reaches the flat,
    // never-inflated staticTargetBalance.
    let balance = scenario.currentBalance;
    let oldEarliestOnTrackAge: number | undefined;
    for (let age = scenario.currentAge; age <= (scenario.lifeExpectancy ?? 100); age += 1) {
      if (oldEarliestOnTrackAge === undefined && balance >= staticTargetBalance) {
        oldEarliestOnTrackAge = age;
      }
      if (age === (scenario.lifeExpectancy ?? 100)) break;
      const yearsFromNow = age - scenario.currentAge;
      const contributionInYear =
        scenario.annualContribution * (1 + (scenario.inflationRate ?? 0.025)) ** yearsFromNow;
      balance = balance * (1 + (scenario.annualReturnRate ?? 0.068)) + contributionInYear;
    }

    const result = calculateRetirementNumber(scenario);

    // Fixed engine: targetBalance is inflated to retirementAge, so it is strictly larger
    // than the old static figure, and the fixed engine's earliest-on-track age is strictly
    // later than the old buggy logic's (or, as here, the old logic wrongly reported the
    // requested age itself as on-track while the fixed engine reports shortBy at that age).
    expect(result.targetBalance).toBeGreaterThan(staticTargetBalance);
    expect(oldEarliestOnTrackAge).toBeLessThanOrEqual(scenario.retirementAge);
    expect(result.status).toBe('shortBy');
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
