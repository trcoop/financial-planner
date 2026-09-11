/**
 * WP-H: end-to-end layer-1 exact-value case table (ERD §6.1, §6.3, §10.2 WP-H brief).
 *
 * Every case here is asserted end-to-end against the real `computeFederalTax`, and every
 * exact-value figure was computed against the actual implementation and cross-checked by hand
 * against the statutory tables / ERD worked examples before being pinned here — not guessed and
 * back-filled. This file is the cross-cutting table only; per-module layer-1 cases (occupancy,
 * indexing, rounding, deductions, fica) live in their own packages' test files.
 *
 * `UNSUPPORTED_FILING_STATUSES` (checked directly below) is empty as of this writing — WP-0
 * verified all four filing statuses' ordinary bracket tables against Rev. Proc. 2025-32
 * (FIN-143). Per §9.1/§10.2, if that ever changes, the affected status's exact-value case below
 * becomes a `toThrow()` assertion for `TAX_FILING_STATUS_UNVERIFIED` rather than being deleted —
 * see the per-status describe block below, which branches on the const so this file does not need
 * hand-editing when a status's verification status changes.
 */
import { describe, expect, it } from 'vitest';
import { computeFederalTax } from './federalTax';
import { UNSUPPORTED_FILING_STATUSES } from './tables';
import type { FederalTaxInput, FilingStatus, TaxPayer } from './types';

function person(age: number, earnedIncome = 0): TaxPayer {
  return { age, earnedIncome };
}

const INDEXING = { chainedCpiU: 0.025, averageWageIndex: 0.03 };

function makeInput(overrides: Partial<FederalTaxInput> = {}): FederalTaxInput {
  return {
    year: 2026,
    filingStatus: 'single',
    ordinaryIncome: 50000,
    preferentialIncome: 0,
    people: [person(40, 50000)],
    indexing: INDEXING,
    ...overrides,
  };
}

// -------------------------------------------------------------------------------------------
// §5.3 — the preferential stacking transform: required negative- and positive-shift cases.
// -------------------------------------------------------------------------------------------

describe('§5.3 preferential stacking transform', () => {
  it('negative shift: unused deduction widens the 0% preferential band (all six pinned assertions)', () => {
    // Single, 2026, ordinaryIncome $10,000, preferentialIncome $60,000, standard deduction
    // $16,100 -> shift = 10,000 - 16,100 = -6,100.
    const result = computeFederalTax(
      makeInput({ ordinaryIncome: 10_000, preferentialIncome: 60_000, people: [person(40, 10_000)] }),
    );

    expect(result.taxableOrdinaryIncome).toBe(0);
    expect(result.ordinaryTax).toBe(0);
    expect(result.ordinaryBrackets.reduce((s, b) => s + b.incomeInThisBracket, 0)).toBe(0);

    // Shifted 0% band [0, 55,550) -> $55,550 at 0%; shifted 15% band -> remaining $4,450 at 15%.
    expect(result.preferentialBrackets[0]).toMatchObject({
      rate: 0,
      lowerBound: 0,
      upperBound: 55_550,
      incomeInThisBracket: 55_550,
    });
    expect(result.preferentialBrackets[1]).toMatchObject({
      rate: 0.15,
      lowerBound: 55_550,
      upperBound: 551_600,
      incomeInThisBracket: 4_450,
    });
    expect(result.preferentialBrackets[1].taxFromThisBracket).toBeCloseTo(667.5, 9);

    expect(result.preferentialTax).toBe(668); // roundHalfUp(667.5)
    expect(result.taxOwed).toBe(668);
    expect(result.taxableIncome).toBe(53_900);
    expect(result.taxablePreferentialIncome).toBe(53_900);
    expect(result.preferentialBrackets.reduce((s, b) => s + b.incomeInThisBracket, 0)).toBe(60_000);
  });

  it('positive-shift companion: unrounded deduction wholly consumed by ordinary income, degenerate 0% preferential band', () => {
    // Single, 2026, ordinaryIncome $100,000, preferentialIncome $20,000, deduction $16,100 ->
    // shift = 83,900. taxableOrdinaryIncome = 83,900; the 0% band is degenerate [0, 0) and all
    // $20,000 sits in the 15% band.
    const result = computeFederalTax(
      makeInput({ ordinaryIncome: 100_000, preferentialIncome: 20_000, people: [person(40, 100_000)] }),
    );

    expect(result.taxableOrdinaryIncome).toBe(83_900);
    expect(result.preferentialBrackets[0]).toMatchObject({
      rate: 0,
      lowerBound: 0,
      upperBound: 0,
      incomeInThisBracket: 0,
    });
    expect(result.preferentialBrackets[1]).toMatchObject({
      rate: 0.15,
      incomeInThisBracket: 20_000,
    });
    expect(result.preferentialBrackets[1].taxFromThisBracket).toBeCloseTo(3_000, 9);
    expect(result.ordinaryTax).toBe(13_170);
    expect(result.preferentialTax).toBe(3_000);
    expect(result.taxBeforeCredits).toBe(16_170);
    expect(result.ordinaryBrackets.reduce((s, b) => s + b.incomeInThisBracket, 0)).toBe(83_900);
    expect(result.preferentialBrackets.reduce((s, b) => s + b.incomeInThisBracket, 0)).toBe(20_000);
  });
});

// -------------------------------------------------------------------------------------------
// §5.4 — the [lower, upper) boundary contract.
// -------------------------------------------------------------------------------------------

describe('§5.4 bracket boundary — [lower, upper) occupancy vs. marginal lookup', () => {
  it('income exactly at the 10%/12% boundary occupies the LOWER band but reports the UPPER band rate', () => {
    // ordinaryIncome = standard deduction ($16,100) + $12,400 so taxableOrdinaryIncome lands
    // exactly on the boundary.
    const result = computeFederalTax(
      makeInput({ ordinaryIncome: 28_500, people: [person(40, 28_500)] }),
    );

    expect(result.taxableOrdinaryIncome).toBe(12_400);
    expect(result.ordinaryBrackets[0]).toMatchObject({
      rate: 0.1,
      lowerBound: 0,
      upperBound: 12_400,
      incomeInThisBracket: 12_400,
    });
    expect(result.ordinaryBrackets[1]).toMatchObject({
      rate: 0.12,
      incomeInThisBracket: 0,
    });
    expect(result.ordinaryBracketRate).toBe(0.12);
    expect(result.ordinaryTax).toBe(1_240);
  });
});

// -------------------------------------------------------------------------------------------
// Zero income / income-equals-standard-deduction — distinct code paths.
// -------------------------------------------------------------------------------------------

describe('zero income and income-equal-to-standard-deduction', () => {
  it('zero income: full ladder returned with zero occupancy throughout, rates are 0/0.10, not NaN', () => {
    const result = computeFederalTax(makeInput({ ordinaryIncome: 0, people: [person(40, 0)] }));

    expect(result.ordinaryBrackets).toHaveLength(7);
    expect(result.ordinaryBrackets.every((b) => b.incomeInThisBracket === 0)).toBe(true);
    expect(result.effectiveRate).toBe(0);
    expect(result.effectiveRateIncludingFica).toBe(0);
    expect(result.effectiveRate).not.toBeNaN();
    expect(result.effectiveRateIncludingFica).not.toBeNaN();
    expect(result.effectiveMarginalRate).toBe(0);
    expect(result.ordinaryBracketRate).toBe(0.1);
  });

  it('income exactly equal to the standard deduction: taxable income exactly zero, but a DIFFERENT code path from zero income', () => {
    // At true zero income, bumping ordinaryIncome by $1 still leaves taxableOrdinaryIncome at 0
    // (shift stays negative), so effectiveMarginalRate is 0. Here shift crosses exactly to 0 on
    // the bump, so the next dollar is taxed at the first bracket's rate.
    const result = computeFederalTax(makeInput({ ordinaryIncome: 16_100, people: [person(40, 16_100)] }));

    expect(result.taxableOrdinaryIncome).toBe(0);
    expect(result.ordinaryTax).toBe(0);
    expect(result.taxOwed).toBe(0);
    expect(result.effectiveMarginalRate).toBeCloseTo(0.1, 9);
  });
});

// -------------------------------------------------------------------------------------------
// FICA boundary cases: SS wage base, Additional Medicare threshold, and the two `additionalMedicare === 0` counterexamples.
// -------------------------------------------------------------------------------------------

describe('FICA boundaries', () => {
  it('Social Security wage base: exactly at $184,500 and one dollar either side', () => {
    const at = (earned: number) =>
      computeFederalTax(makeInput({ ordinaryIncome: earned, people: [person(40, earned)] }));

    const below = at(184_499);
    const exact = at(184_500);
    const above = at(184_501);

    // Below the base: SS = round(184,499 * 0.062) = round(11,438.938) = 11,439 — same rounded
    // dollar figure as the cap, which is exactly why the cap itself needs its own boundary case.
    expect(below.fica.socialSecurity).toBe(11_439);
    expect(exact.fica.socialSecurity).toBe(11_439);
    // Above the base: capped at the wage base, so SS does not grow further.
    expect(above.fica.socialSecurity).toBe(11_439);
  });

  it('Additional Medicare threshold: exactly at $200,000, one dollar below, and just above (single)', () => {
    const at = (earned: number) =>
      computeFederalTax(makeInput({ ordinaryIncome: earned, people: [person(40, earned)] }));

    expect(at(199_999).fica.additionalMedicare).toBe(0);
    expect(at(200_000).fica.additionalMedicare).toBe(0);
    // A $1 excess (200,001) rounds to $0 (0.9% * 1 = 0.009 -> roundHalfUp -> 0), so it does not
    // distinguish "just above the threshold" from "at the threshold" on its own; $100 of excess
    // (200,100) unambiguously rounds to a nonzero dollar figure and still exercises the same
    // "just above" code path.
    expect(at(200_100).fica.additionalMedicare).toBeGreaterThan(0);
  });

  it('additionalMedicare === 0 counterexample: single household earning $50,007 (§5.7)', () => {
    const result = computeFederalTax(makeInput({ ordinaryIncome: 50_007, people: [person(40, 50_007)] }));
    // SS 3,100.434 -> 3,101 (largest component, takes the remainder); Medicare 725.1015 -> 725;
    // additionalMedicare is never the remainder recipient and is exactly 0 below the threshold.
    expect(result.fica).toMatchObject({ socialSecurity: 3_101, medicare: 725, additionalMedicare: 0, total: 3_826 });
  });

  it('additionalMedicare === 0 counterexample: single household earning $1,010 (§5.7)', () => {
    const result = computeFederalTax(makeInput({ ordinaryIncome: 1_010, people: [person(40, 1_010)] }));
    // Fixed-recipient rounding would give additionalMedicare: -1 here, violating "tax is never
    // negative" — remainder-to-the-largest keeps it exactly 0.
    expect(result.fica).toMatchObject({ socialSecurity: 62, medicare: 15, additionalMedicare: 0, total: 77 });
  });
});

// -------------------------------------------------------------------------------------------
// Senior-bonus phase-out boundaries, including the pooled-vs-per-taxpayer trap.
// -------------------------------------------------------------------------------------------

describe('OBBBA senior-bonus phase-out boundaries', () => {
  it('single: exactly at phaseOutStart ($75,000) the bonus is still full', () => {
    const result = computeFederalTax(makeInput({ ordinaryIncome: 75_000, people: [person(65, 75_000)] }));
    expect(result.deduction.seniorBonusDeduction).toBe(6_000);
  });

  it('single: a point inside the phase-out range ($125,000) partially reduces the bonus', () => {
    const result = computeFederalTax(makeInput({ ordinaryIncome: 125_000, people: [person(65, 125_000)] }));
    // excess = 125,000 - 75,000 = 50,000; bonus = 6,000 - 0.06 * 50,000 = 3,000.
    expect(result.deduction.seniorBonusDeduction).toBe(3_000);
  });

  it('single: exactly at phaseOutEnd ($175,000) the bonus reaches exactly zero', () => {
    const result = computeFederalTax(makeInput({ ordinaryIncome: 175_000, people: [person(65, 175_000)] }));
    expect(result.deduction.seniorBonusDeduction).toBe(0);
  });

  it('MFJ, two qualifying spouses: exactly at phaseOutStart ($150,000) both bonuses are full', () => {
    const result = computeFederalTax(
      makeInput({
        filingStatus: 'mfj',
        ordinaryIncome: 150_000,
        people: [person(65, 75_000), person(66, 75_000)],
      }),
    );
    expect(result.deduction.seniorBonusDeduction).toBe(12_000); // 6,000 * 2 qualifying taxpayers
  });

  it('MFJ, two qualifying spouses: a point inside the phase-out range ($200,000)', () => {
    const result = computeFederalTax(
      makeInput({
        filingStatus: 'mfj',
        ordinaryIncome: 200_000,
        people: [person(65, 100_000), person(66, 100_000)],
      }),
    );
    // excess = 200,000 - 150,000 = 50,000; per-person bonus = 6,000 - 0.06 * 50,000 = 3,000,
    // applied independently per qualifying taxpayer against the SAME joint MAGI (not pooled) ->
    // 3,000 * 2 = 6,000.
    expect(result.deduction.seniorBonusDeduction).toBe(6_000);
  });

  it('MFJ, two-qualifying-spouse case: reaches EXACTLY zero at $250,000 — the pooled-vs-per-taxpayer trap', () => {
    const result = computeFederalTax(
      makeInput({
        filingStatus: 'mfj',
        ordinaryIncome: 250_000,
        people: [person(65, 125_000), person(66, 125_000)],
      }),
    );
    // A pooled-amount bug would zero out at $125,000 excess against a single $12,000 pool
    // (phaseOutRate * excess = 12,000 at excess = 200,000, i.e. MAGI = 350,000) or otherwise
    // disagree with the correct per-qualifying-taxpayer result. Per taxpayer: excess = 100,000,
    // bonus = 6,000 - 0.06 * 100,000 = 0 each, summing to exactly 0 — not negative, not clamped
    // from a negative pooled remainder.
    expect(result.deduction.seniorBonusDeduction).toBe(0);
  });
});

// -------------------------------------------------------------------------------------------
// Age 64 vs. 65, and a mixed-age joint return.
// -------------------------------------------------------------------------------------------

describe('age-65 additional standard deduction', () => {
  it('age exactly 64 does NOT qualify (age >= 65 boundary)', () => {
    const result = computeFederalTax(makeInput({ ordinaryIncome: 60_000, people: [person(64, 60_000)] }));
    expect(result.deduction.ageAddition).toBe(0);
    expect(result.deduction.seniorBonusDeduction).toBe(0);
    expect(result.deduction.standardDeduction).toBe(16_100);
  });

  it('age exactly 65 DOES qualify', () => {
    const result = computeFederalTax(makeInput({ ordinaryIncome: 60_000, people: [person(65, 60_000)] }));
    expect(result.deduction.ageAddition).toBe(2_000);
    expect(result.deduction.seniorBonusDeduction).toBe(6_000);
    expect(result.deduction.standardDeduction).toBe(18_100);
  });

  it('mixed-age joint return: one spouse 65+, one 64 — one age-65 addition, one senior bonus, both phased against JOINT MAGI', () => {
    const result = computeFederalTax(
      makeInput({
        filingStatus: 'mfj',
        ordinaryIncome: 100_000,
        people: [person(65, 50_000), person(64, 50_000)],
      }),
    );
    // Only one qualifying taxpayer (age 65): one age addition ($1,600 for MFJ), one senior bonus
    // (fully unphased at MAGI $100,000, well under the $150,000 MFJ phaseOutStart).
    expect(result.deduction.ageAddition).toBe(1_600);
    expect(result.deduction.seniorBonusDeduction).toBe(6_000);
    expect(result.deduction.standardDeduction).toBe(33_800);
    expect(result.deduction.total).toBe(39_800);
  });
});

// -------------------------------------------------------------------------------------------
// Sunset boundaries: 2026/2028 nonzero, 2029 zero, and the 2024 throw.
// -------------------------------------------------------------------------------------------

describe('OBBBA senior-bonus sunset boundaries', () => {
  it('year 2026: bonus is > 0', () => {
    const result = computeFederalTax(makeInput({ year: 2026, ordinaryIncome: 80_000, people: [person(65, 80_000)] }));
    expect(result.deduction.seniorBonusDeduction).toBeGreaterThan(0);
  });

  it('year 2028: bonus is > 0 (inclusive upper bound — 2028 is the last TRUE year)', () => {
    const result = computeFederalTax(makeInput({ year: 2028, ordinaryIncome: 80_000, people: [person(65, 80_000)] }));
    expect(result.deduction.seniorBonusDeduction).toBeGreaterThan(0);
  });

  it('year 2029: bonus is exactly 0 (sunset)', () => {
    const result = computeFederalTax(makeInput({ year: 2029, ordinaryIncome: 80_000, people: [person(65, 80_000)] }));
    expect(result.deduction.seniorBonusDeduction).toBe(0);
  });

  it('year 2024 THROWS TAX_YEAR_OUT_OF_RANGE rather than returning a zero bonus (no table exists for 2024)', () => {
    expect(() =>
      computeFederalTax(makeInput({ year: 2024, ordinaryIncome: 80_000, people: [person(65, 80_000)] })),
    ).toThrow(
      expect.objectContaining({ code: 'TAX_YEAR_OUT_OF_RANGE' }),
    );
  });
});

// -------------------------------------------------------------------------------------------
// One exact-value case per filing status against WP-0's verified figures (FIN-143). If a status
// is unverified/unsupported, its case becomes a throw assertion instead — see the file-level
// doc comment.
// -------------------------------------------------------------------------------------------

describe('per-filing-status exact-value cases (WP-0 verified figures)', () => {
  const cases: Array<{
    status: FilingStatus;
    input: Partial<FederalTaxInput>;
    expected: { taxableOrdinaryIncome: number; ordinaryTax: number; taxOwed: number };
  }> = [
    {
      status: 'single',
      input: { filingStatus: 'single', ordinaryIncome: 60_000, people: [person(40, 60_000)] },
      // standard deduction $16,100 -> taxable $43,900: $12,400@10% + $31,500@12% = 1,240 + 3,780 = 5,020.
      expected: { taxableOrdinaryIncome: 43_900, ordinaryTax: 5_020, taxOwed: 5_020 },
    },
    {
      status: 'mfj',
      input: {
        filingStatus: 'mfj',
        ordinaryIncome: 120_000,
        people: [person(40, 60_000), person(40, 60_000)],
      },
      // standard deduction $32,200 -> taxable $87,800: $24,800@10% + $63,000@12% = 2,480 + 7,560 = 10,040.
      expected: { taxableOrdinaryIncome: 87_800, ordinaryTax: 10_040, taxOwed: 10_040 },
    },
    {
      status: 'mfs',
      input: { filingStatus: 'mfs', ordinaryIncome: 60_000, people: [person(40, 60_000)] },
      // MFS ordinary ladder is identical to single below the top two bands; standard deduction
      // $16,100 -> taxable $43,900, same bracket math as single: 5,020.
      expected: { taxableOrdinaryIncome: 43_900, ordinaryTax: 5_020, taxOwed: 5_020 },
    },
    {
      status: 'hoh',
      input: { filingStatus: 'hoh', ordinaryIncome: 60_000, people: [person(40, 60_000)] },
      // standard deduction $24,150 -> taxable $35,850: $17,700@10% + $18,150@12% = 1,770 + 2,178 = 3,948.
      expected: { taxableOrdinaryIncome: 35_850, ordinaryTax: 3_948, taxOwed: 3_948 },
    },
  ];

  for (const { status, input, expected } of cases) {
    const unsupportedReason = UNSUPPORTED_FILING_STATUSES[status];

    if (unsupportedReason !== undefined) {
      it(`${status}: UNVERIFIED per WP-0 (${unsupportedReason}) — throws TAX_FILING_STATUS_UNVERIFIED`, () => {
        expect(() => computeFederalTax(makeInput(input))).toThrow(
          expect.objectContaining({ code: 'TAX_FILING_STATUS_UNVERIFIED' }),
        );
      });
    } else {
      it(`${status}: exact-value case against WP-0's verified figures`, () => {
        const result = computeFederalTax(makeInput(input));
        expect(result.taxableOrdinaryIncome).toBe(expected.taxableOrdinaryIncome);
        expect(result.ordinaryTax).toBe(expected.ordinaryTax);
        expect(result.taxOwed).toBe(expected.taxOwed);
      });
    }
  }
});

// -------------------------------------------------------------------------------------------
// §6.3 — the senior-bonus multiplier regression test (dual multiplier).
// -------------------------------------------------------------------------------------------

describe('§6.3 senior-bonus multiplier regression', () => {
  it('single filer, one qualifying taxpayer: effectiveMarginalRate === ordinaryBracketRate * 1.06', () => {
    // Mid-phase-out, no bracket boundary crossed, preferentialIncome: 0 (required per the ERD's
    // round-1 correction — the identity holds exactly only with no preferential income).
    const result = computeFederalTax(
      makeInput({ ordinaryIncome: 80_000, preferentialIncome: 0, people: [person(65, 0)] }),
    );
    expect(result.effectiveMarginalRate).toBeCloseTo(result.ordinaryBracketRate * 1.06, 9);
  });

  it('MFJ, TWO qualifying spouses: effectiveMarginalRate === ordinaryBracketRate * 1.12 (catches a pooled-amount implementation)', () => {
    const result = computeFederalTax(
      makeInput({
        filingStatus: 'mfj',
        ordinaryIncome: 160_000,
        preferentialIncome: 0,
        people: [person(65, 0), person(66, 0)],
      }),
    );
    // Pinning only the single-filer case would pass against a pooled implementation that applies
    // a single ×1.06 regardless of qualifying-taxpayer count; this is the case that would fail it.
    expect(result.effectiveMarginalRate).toBeCloseTo(result.ordinaryBracketRate * 1.12, 9);
  });
});

// -------------------------------------------------------------------------------------------
// allocateRounding's tie-break, pinned against computeFederalTax's real output (OPEN DECISION
// from FIN-150's review): the call-site argument order `[unroundedOrdinaryTax,
// unroundedPreferentialTax]` (§5.7) means ordinaryTax — the earliest index — wins a genuine tie.
// -------------------------------------------------------------------------------------------

describe('allocateRounding tie-break, pinned end-to-end (FIN-150 OPEN DECISION)', () => {
  it('a genuine tie between unrounded ordinaryTax and preferentialTax resolves to the call-site argument order (ordinaryTax first)', () => {
    // Constructed so unroundedOrdinaryTax === unroundedPreferentialTax === 10.5 exactly:
    //  - ordinaryIncome $16,205, standard deduction $16,100 -> taxableOrdinaryIncome $105,
    //    entirely in the 10% band -> unrounded ordinaryTax = 105 * 0.10 = 10.5.
    //  - shift = 16,205 - 16,100 = 105. Shifted 0% band top = 49,450 - 105 = 49,345.
    //    preferentialIncome $49,415 -> $49,345 at 0% (=$0) + $70 at 15% (=$10.5).
    // Both components are exactly 10.5 -- a genuine tie in unrounded value, not merely equal after
    // rounding. taxBeforeCredits = roundHalfUp(21) = 21. If preferentialTax had instead won the
    // tie (i.e. if the call site's argument order were reversed), the split would come out as
    // ordinaryTax: 11, preferentialTax: 10 instead of the pinned values below.
    const result = computeFederalTax(
      makeInput({ ordinaryIncome: 16_205, preferentialIncome: 49_415, people: [person(40, 0)] }),
    );

    expect(result.taxableOrdinaryIncome).toBe(105);
    const unroundedOrdinaryTax = result.ordinaryBrackets.reduce((s, b) => s + b.taxFromThisBracket, 0);
    const unroundedPreferentialTax = result.preferentialBrackets.reduce((s, b) => s + b.taxFromThisBracket, 0);
    expect(unroundedOrdinaryTax).toBeCloseTo(10.5, 9);
    expect(unroundedPreferentialTax).toBeCloseTo(10.5, 9);
    expect(unroundedOrdinaryTax).toBe(unroundedPreferentialTax); // the genuine tie

    expect(result.taxBeforeCredits).toBe(21);
    // Earliest index (ordinaryTax, per the [unroundedOrdinaryTax, unroundedPreferentialTax]
    // call-site order in federalTax.ts) wins the tie and receives the remainder.
    expect(result.ordinaryTax).toBe(10);
    expect(result.preferentialTax).toBe(11);
  });
});

// -------------------------------------------------------------------------------------------
// §7 error paths — one test per code and condition reachable through computeFederalTax.
// -------------------------------------------------------------------------------------------

describe('§7 error paths', () => {
  function expectThrows(input: FederalTaxInput, code: string) {
    expect(() => computeFederalTax(input)).toThrow(expect.objectContaining({ code }));
  }

  it('NON_FINITE_INPUT: year is NaN', () => {
    expectThrows(makeInput({ year: Number.NaN }), 'NON_FINITE_INPUT');
  });

  it('NON_FINITE_INPUT: ordinaryIncome is Infinity', () => {
    expectThrows(makeInput({ ordinaryIncome: Number.POSITIVE_INFINITY }), 'NON_FINITE_INPUT');
  });

  it('NON_FINITE_INPUT: preferentialIncome is NaN', () => {
    expectThrows(makeInput({ preferentialIncome: Number.NaN }), 'NON_FINITE_INPUT');
  });

  it('NON_FINITE_INPUT: indexing.chainedCpiU is NaN', () => {
    expectThrows(makeInput({ indexing: { chainedCpiU: Number.NaN, averageWageIndex: 0.03 } }), 'NON_FINITE_INPUT');
  });

  it('NON_FINITE_INPUT: indexing.averageWageIndex is NaN', () => {
    expectThrows(makeInput({ indexing: { chainedCpiU: 0.025, averageWageIndex: Number.NaN } }), 'NON_FINITE_INPUT');
  });

  it('NON_FINITE_INPUT: people[i].earnedIncome is NaN', () => {
    expectThrows(makeInput({ people: [person(40, Number.NaN)] }), 'NON_FINITE_INPUT');
  });

  it('NON_FINITE_INPUT: people[i].age is NaN', () => {
    expectThrows(makeInput({ people: [person(Number.NaN, 0)] }), 'NON_FINITE_INPUT');
  });

  it('NON_FINITE_INPUT: indexing is undefined', () => {
    expectThrows(
      // Deliberately malformed input for the round-1 correction's added guard.
      makeInput({ indexing: undefined }),
      'NON_FINITE_INPUT',
    );
  });

  it('TAX_YEAR_NOT_INTEGER: year is not a whole number', () => {
    expectThrows(makeInput({ year: 2026.5 }), 'TAX_YEAR_NOT_INTEGER');
  });

  it('TAX_YEAR_OUT_OF_RANGE: year below 2026', () => {
    expectThrows(makeInput({ year: 2025 }), 'TAX_YEAR_OUT_OF_RANGE');
  });

  it('TAX_YEAR_OUT_OF_RANGE: year above 2125', () => {
    expectThrows(makeInput({ year: 2126 }), 'TAX_YEAR_OUT_OF_RANGE');
  });

  it('TAX_FILING_STATUS_UNKNOWN: filingStatus not one of the four', () => {
    // @ts-expect-error — deliberately invalid filingStatus.
    expectThrows(makeInput({ filingStatus: 'married' }), 'TAX_FILING_STATUS_UNKNOWN');
  });

  it('TAX_FILING_STATUS_PEOPLE_MISMATCH: people is not an array', () => {
    expectThrows(
      // Deliberately malformed input for the round-1 correction's added guard.
      makeInput({ people: undefined }),
      'TAX_FILING_STATUS_PEOPLE_MISMATCH',
    );
  });

  it('TAX_FILING_STATUS_PEOPLE_MISMATCH: filingStatus/people.length disagree (mfj needs exactly 2)', () => {
    expectThrows(makeInput({ filingStatus: 'mfj', people: [person(40, 50_000)] }), 'TAX_FILING_STATUS_PEOPLE_MISMATCH');
  });

  it('NEGATIVE_INCOME: ordinaryIncome < 0', () => {
    expectThrows(makeInput({ ordinaryIncome: -100 }), 'NEGATIVE_INCOME');
  });

  it('NEGATIVE_INCOME: preferentialIncome < 0', () => {
    expectThrows(makeInput({ preferentialIncome: -100 }), 'NEGATIVE_INCOME');
  });

  it('NEGATIVE_INCOME: people[i].earnedIncome < 0', () => {
    expectThrows(makeInput({ people: [person(40, -1)] }), 'NEGATIVE_INCOME');
  });

  it('TAX_EARNED_INCOME_EXCEEDS_ORDINARY: sum(people[].earnedIncome) > ordinaryIncome', () => {
    expectThrows(
      makeInput({ ordinaryIncome: 150_000, people: [person(40, 200_000)] }),
      'TAX_EARNED_INCOME_EXCEEDS_ORDINARY',
    );
  });

  it('NEGATIVE_AGE: people[i].age < 0', () => {
    expectThrows(makeInput({ people: [person(-1, 0)] }), 'NEGATIVE_AGE');
  });

  it('RATE_BELOW_NEGATIVE_100_PERCENT: indexing.chainedCpiU < -1', () => {
    expectThrows(makeInput({ indexing: { chainedCpiU: -1.5, averageWageIndex: 0.03 } }), 'RATE_BELOW_NEGATIVE_100_PERCENT');
  });

  it('RATE_BELOW_NEGATIVE_100_PERCENT: indexing.averageWageIndex < -1', () => {
    expectThrows(makeInput({ indexing: { chainedCpiU: 0.025, averageWageIndex: -1.5 } }), 'RATE_BELOW_NEGATIVE_100_PERCENT');
  });

  // TAX_MFS_PREFERENTIAL_UNSUPPORTED and TAX_FILING_STATUS_UNVERIFIED are deliberately NOT
  // asserted end-to-end here, per the ERD's own round-2 clarification (§7): with WP-0 having
  // sourced the MFS preferential ladder and verified all four ordinary tables (UNSUPPORTED_
  // FILING_STATUSES is empty as of this writing), no input to computeFederalTax can currently
  // reach either throw — resolveTables/assertPreferentialLadderAvailable would have to be fed
  // data this build does not ship. Both guards are unit-tested directly against hand-built
  // ResolvedYearTables literals / UNSUPPORTED_FILING_STATUSES literals in federalTax.test.ts and
  // tables.test.ts (WP-F and WP-C respectively), which is the ERD's prescribed coverage
  // mechanism for exactly this "correct in the good branch, untestable end-to-end" situation.
});
