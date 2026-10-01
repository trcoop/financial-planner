import { describe, expect, it } from 'vitest';

import { birthMonthIndex } from '../age';
import { InvalidProjectionInputError } from '../errors';
import type { ProjectionErrorCode } from '../errors';
import { collectingPia, fraMonths, survivorFraMonths } from './benefit';
import { GOLDEN_FIXTURES } from './goldenFixtures';
import type { GoldenKey } from './goldenFixtures';
import { paidBenefit, survivorBreakdown, survivorPaymentWindow, survivorStartMonth } from './survivor';
import type { SurvivorArgs } from './types';

const mi = (year: number, month: number): number => year * 12 + (month - 1);

function codeOf(fn: () => unknown): ProjectionErrorCode | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof InvalidProjectionInputError) return e.code;
    throw e;
  }
  return undefined;
}

/** Build SurvivorArgs for a golden: person 0 is the deceased, person 1 the survivor. */
function argsFor(key: GoldenKey): SurvivorArgs {
  const { inputs } = GOLDEN_FIXTURES[key];
  const [d, s] = inputs.people;
  if (s === undefined) throw new Error('golden needs two people');
  const dBirth = birthMonthIndex(d.birthYear, d.birthMonth);
  const age = inputs.deathAgeYears?.[0];
  if (age === null || age === undefined) throw new Error('golden needs a deceased death age');
  const deathMonth = dBirth + Math.round(age * 12);
  const claim = d.benefit.kind === 'collecting' ? d.benefit.sinceMonth : inputs.claimMonth[0];
  return {
    deceasedPia: d.benefit.kind === 'pia' ? d.benefit.pia : collectingPia(d, inputs.asOf),
    deceasedBirthYear: d.birthYear,
    deceasedBirthMonth: d.birthMonth,
    // goldens G5/G6 encode "died unclaimed" as a claim month after the death month
    deceasedClaimMonth: claim ?? null,
    deathMonth,
    survivorBirthYear: s.birthYear,
    survivorBirthMonth: s.birthMonth,
    survivorStartMonth: survivorStartMonth(deathMonth, s.birthYear, s.birthMonth),
  };
}

describe('survivorFraMonths (reused from benefit.ts, FIN-163)', () => {
  it('is fraMonths(birthYear - 2)', () => {
    expect(survivorFraMonths(1962)).toBe(fraMonths(1960));
    expect(survivorFraMonths(1962)).toBe(804);
    expect(survivorFraMonths(1943)).toBe(788);
  });
});

describe('survivorBreakdown goldens', () => {
  it('G4: cap binds, min(2562.50, 2310) = 2310.00', () => {
    const r = survivorBreakdown(argsFor('G4'));
    expect(r.base).toBeCloseTo(2800, 6);
    expect(r.ageReduced).toBeCloseTo(2562.5, 2);
    expect(r.cap).toBeCloseTo(2310, 6);
    expect(r.amount).toBeCloseTo(2310, 2);
  });

  it('G5: died unclaimed before FRA = 2562.50, no cap', () => {
    const r = survivorBreakdown(argsFor('G5'));
    expect(r.cap).toBeNull();
    expect(r.base).toBeCloseTo(2800, 6);
    expect(r.amount).toBeCloseTo(2562.5, 2);
  });

  it('G6: died unclaimed after FRA, 12 credit months = 3013.74', () => {
    const r = survivorBreakdown(argsFor('G6'));
    expect(r.base).toBeCloseTo(3024, 6);
    expect(r.cap).toBeNull();
    expect(r.amount).toBeCloseTo(3013.74, 2);
  });

  it('G9: post-FRA claim, cap null = 2767.50', () => {
    const r = survivorBreakdown(argsFor('G9'));
    expect(r.base).toBeCloseTo(3024, 6);
    expect(r.cap).toBeNull();
    expect(r.amount).toBeCloseTo(2767.5, 2);
  });

  it('G10: early claim, cap 2310 does not bind = 2011.50', () => {
    const r = survivorBreakdown(argsFor('G10'));
    expect(r.cap).toBeCloseTo(2310, 6);
    expect(r.ageReduced).toBeCloseTo(2011.5, 2);
    expect(r.amount).toBeCloseTo(2011.5, 2);
  });

  it('E29: claimed at 70, survivor past FRA = 3472 (max with own 1000)', () => {
    const r = survivorBreakdown(argsFor('E29'));
    expect(r.amount).toBeCloseTo(3472, 6);
    expect(paidBenefit(1000, r.amount)).toBeCloseTo(3472, 6);
  });

  it('E40: base uses all claim credits (3024.00), never the as-paid 2912.00', () => {
    const r = survivorBreakdown(argsFor('E40'));
    expect(r.base).toBeCloseTo(3024, 6);
    expect(r.cap).toBeNull();
    expect(r.amount).toBeCloseTo(3024, 2);
    expect(r.amount).not.toBeCloseTo(2912, 2);
    expect(paidBenefit(1000, r.amount)).toBeCloseTo(3024, 2);
  });

  it('E41: survivor under 60 at death starts at 60y1m, 2011.50, household $0 gap before', () => {
    const a = argsFor('E41');
    const survivorBirth = birthMonthIndex(a.survivorBirthYear, a.survivorBirthMonth);
    expect(a.survivorStartMonth).toBe(survivorBirth + 721);
    expect(a.survivorStartMonth).toBeGreaterThan(a.deathMonth);
    const r = survivorBreakdown(a);
    expect(r.amount).toBeCloseTo(2011.5, 2);
    // household = max(survivor own, survivor benefit); own is 0 before it is claimable
    expect(paidBenefit(0, r.amount)).toBeCloseTo(2011.5, 2);
    // months from the death month to the month before the survivor start: household is $0
    expect(a.survivorStartMonth - a.deathMonth).toBeGreaterThan(0);
  });
});

describe('survivorStartMonth (E41 / P6)', () => {
  it('is the later of the death month and the month after the 60th-birthday month', () => {
    const b = mi(1968, 3);
    expect(survivorStartMonth(mi(2027, 11), 1968, 3)).toBe(mi(2028, 4)); // under 60: deferred
    expect(survivorStartMonth(mi(2028, 3), 1968, 3)).toBe(mi(2028, 4)); // death in 60th-birthday month
    expect(survivorStartMonth(mi(2028, 4), 1968, 3)).toBe(mi(2028, 4)); // death at 60y1m
    expect(survivorStartMonth(mi(2030, 1), 1968, 3)).toBe(mi(2030, 1)); // already past 60
    expect(mi(2028, 4)).toBe(b + 721);
  });
});

describe('credit months rule (E42): deathMonthIndex - FRAmonthIndex', () => {
  const base = (deathMonth: number) =>
    survivorBreakdown({
      deceasedPia: 3000,
      deceasedBirthYear: 1960,
      deceasedBirthMonth: 12,
      deceasedClaimMonth: null,
      deathMonth,
      survivorBirthYear: 1950,
      survivorBirthMonth: 1,
      survivorStartMonth: deathMonth,
    }).base;
  const fraIdx = mi(1960, 12) + 804; // Dec 2027

  it('death in the FRA month: 0 credits (FRA month in, death month out)', () => {
    expect(base(fraIdx)).toBeCloseTo(3000, 8);
  });
  it('death one month after FRA month: exactly 1 credit month', () => {
    expect(base(fraIdx + 1)).toBeCloseTo(3000 * (1 + 1 / 150), 8);
  });
  it('death 12 months after the FRA month: 12 credit months', () => {
    expect(base(fraIdx + 12)).toBeCloseTo(3000 * (1 + 12 / 150), 8);
  });
  it('death the month before FRA: no credits', () => {
    expect(base(fraIdx - 1)).toBeCloseTo(3000, 8);
  });
  it('credits stop at the 70th birthday', () => {
    expect(base(mi(1960, 12) + 840 + 24)).toBeCloseTo(3000 * (1 + 36 / 150), 8);
  });
});

describe('cap rule', () => {
  const claimed = (claimMonth: number, pia = 2800, deathMonth = mi(2030, 1)): SurvivorArgs => ({
    deceasedPia: pia,
    deceasedBirthYear: 1960,
    deceasedBirthMonth: 6,
    deceasedClaimMonth: claimMonth,
    deathMonth,
    survivorBirthYear: 1962,
    survivorBirthMonth: 6,
    survivorStartMonth: deathMonth,
  });
  const fra = mi(1960, 6) + 804;

  it('cap applies only when the deceased claimed strictly before FRA', () => {
    expect(survivorBreakdown(claimed(fra - 1)).cap).not.toBeNull();
    expect(survivorBreakdown(claimed(fra)).cap).toBeNull();
    expect(survivorBreakdown(claimed(fra + 1)).cap).toBeNull();
  });
  it('cap = max(RIB, 0.825 PIA): RIB wins when larger (claimed 1 month before FRA)', () => {
    const r = survivorBreakdown(claimed(fra - 1));
    expect(r.cap).toBeCloseTo(2800 * (1 - 1 / 180), 6);
    expect(r.cap).toBeGreaterThan(2800 * 0.825);
  });
  it('cap = 0.825 PIA when RIB is smaller', () => {
    expect(survivorBreakdown(claimed(mi(1960, 6) + 745)).cap).toBeCloseTo(2310, 6);
  });
  it('a claim after the death month is the died-unclaimed branch (no cap)', () => {
    const r = survivorBreakdown(claimed(mi(2027, 2), 2800, mi(2027, 1))); // dies before FRA, claim planned a month later
    expect(r.cap).toBeNull();
    expect(r.base).toBeCloseTo(2800, 6);
  });
  it('uses the survivor FRA (birth year - 2 cohort), not the regular FRA, for the reduction', () => {
    // survivor born 1958: survivor FRA 796 (=FRA of 1956), regular FRA 800. At 65y0m (780): 16 months short.
    const start = mi(1958, 6) + 780;
    const r = survivorBreakdown({ ...claimed(fra + 1), deathMonth: start, survivorStartMonth: start, survivorBirthYear: 1958 });
    expect(r.ageReduced / r.base).toBeCloseTo(1 - (0.285 * 16) / (796 - 720), 10);
  });
  it('a claim in the death month itself is a claimed branch (cap applies when pre-FRA)', () => {
    const dm = mi(2024, 1); // deceased age 63y7m, claims in the death month
    const r = survivorBreakdown(claimed(dm, 2800, dm));
    expect(r.cap).not.toBeNull();
  });
  it('survivor at or past survivor FRA gets no reduction', () => {
    const a = { ...claimed(fra + 1), survivorBirthYear: 1950, survivorBirthMonth: 1 };
    const r = survivorBreakdown(a);
    expect(r.ageReduced).toBeCloseTo(r.base, 8);
  });
});

describe('E10 payment rules', () => {
  it('survivor is paid from the deceased death month to the month before survivor death', () => {
    expect(survivorPaymentWindow(mi(2030, 5), mi(2040, 8))).toEqual({ first: mi(2030, 5), last: mi(2040, 7) });
    expect(survivorPaymentWindow(mi(2030, 5), null)).toEqual({ first: mi(2030, 5), last: null });
  });
  it('same-month deaths: no survivor benefit is ever paid', () => {
    expect(survivorPaymentWindow(mi(2030, 5), mi(2030, 5))).toBeNull();
  });
  it('deaths one month apart: exactly one survivor payment (the deceased death month)', () => {
    expect(survivorPaymentWindow(mi(2030, 5), mi(2030, 6))).toEqual({ first: mi(2030, 5), last: mi(2030, 5) });
  });
  it('survivor dying before the deceased has no survivor window', () => {
    expect(survivorPaymentWindow(mi(2030, 5), mi(2029, 1))).toBeNull();
  });
  it('rejects non-integer months', () => {
    expect(codeOf(() => survivorPaymentWindow(2030.5, null))).toBe('SS_INVALID_DEATH');
  });
});

describe('paidBenefit: larger of own and survivor, never both', () => {
  it('returns the max', () => {
    expect(paidBenefit(1000, 3472)).toBe(3472);
    expect(paidBenefit(3500, 3472)).toBe(3500);
    expect(paidBenefit(0, 2011.5)).toBe(2011.5);
  });
});

describe('validation', () => {
  const ok: SurvivorArgs = {
    deceasedPia: 2800,
    deceasedBirthYear: 1960,
    deceasedBirthMonth: 6,
    deceasedClaimMonth: null,
    deathMonth: mi(2030, 1),
    survivorBirthYear: 1962,
    survivorBirthMonth: 6,
    survivorStartMonth: mi(2030, 1),
  };
  const withArgs = (p: Partial<SurvivorArgs>) => () => survivorBreakdown({ ...ok, ...p });

  it('accepts the base args', () => {
    expect(withArgs({})).not.toThrow();
  });
  it('negative PIA', () => expect(codeOf(withArgs({ deceasedPia: -1 }))).toBe('SS_NEGATIVE_BENEFIT'));
  it('non-finite PIA', () => expect(codeOf(withArgs({ deceasedPia: NaN }))).toBe('NON_FINITE_INPUT'));
  it('deceased born before 1943', () =>
    expect(codeOf(withArgs({ deceasedBirthYear: 1942 }))).toBe('SS_UNSUPPORTED_BIRTH_YEAR'));
  it('survivor born before 1943', () =>
    expect(codeOf(withArgs({ survivorBirthYear: 1942 }))).toBe('SS_UNSUPPORTED_BIRTH_YEAR'));
  it('bad birth month', () => expect(codeOf(withArgs({ survivorBirthMonth: 13 }))).toBe('SS_INVALID_BIRTH'));
  it('survivor start before the survivor is 60y1m', () => {
    const start = mi(1962, 6) + 720;
    expect(codeOf(withArgs({ deathMonth: start, survivorStartMonth: start }))).toBe('SS_INVALID_DEATH');
  });
  it('survivor start before the death month', () =>
    expect(codeOf(withArgs({ survivorStartMonth: mi(2029, 12) }))).toBe('SS_INVALID_DEATH'));
  it('non-integer death month', () => expect(codeOf(withArgs({ deathMonth: 24000.5 }))).toBe('SS_INVALID_DEATH'));
  it('deceased claim before 62y1m', () =>
    expect(codeOf(withArgs({ deceasedClaimMonth: mi(1960, 6) + 744 }))).toBe('SS_CLAIM_BEFORE_ELIGIBLE'));
  it('deceased claim after 70y0m', () =>
    expect(
      codeOf(withArgs({ deceasedClaimMonth: mi(1960, 6) + 841, deathMonth: mi(2031, 1), survivorStartMonth: mi(2031, 1) })),
    ).toBe('SS_CLAIM_AFTER_70'));
});
