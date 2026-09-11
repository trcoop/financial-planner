/**
 * WP-I: layer-2 property tests (ERD §6.2, §6.2.1).
 *
 * Tooling decision (ERD §6.2, recorded in §9.3): no property-testing library is added. The repo
 * has zero runtime dependencies beyond React and no `fast-check`; the engine already exports
 * `createSeededRandom` (`src/engine/monteCarlo.ts`). Properties here are deterministic sweeps — a
 * fixed seeded generator plus fixed boundary grids — so CI is reproducible and a failure is
 * replayable from the printed seed/index.
 *
 * Standing instruction (§6.2.1): if a generated counterexample falsifies a property, the property
 * is DROPPED and the finding recorded as a comment — the engine is never "fixed" to satisfy a
 * wrong invariant.
 */
import { describe, expect, it } from 'vitest';
import { createSeededRandom } from '../monteCarlo';
import { computeFederalTax } from './federalTax';
import { resolveTables } from './tables';
import type { FederalTaxInput, FilingStatus, TaxPayer } from './types';

const INDEXING = { chainedCpiU: 0.025, averageWageIndex: 0.03 };
const STATUSES: FilingStatus[] = ['single', 'mfj', 'mfs', 'hoh'];
const PEOPLE_COUNT: Record<FilingStatus, number> = { single: 1, mfj: 2, mfs: 1, hoh: 1 };

function person(age: number, earnedIncome: number): TaxPayer {
  return { age, earnedIncome };
}

function makePeople(status: FilingStatus, ages: number[], earnedIncomes: number[]): TaxPayer[] {
  const count = PEOPLE_COUNT[status];
  return Array.from({ length: count }, (_, i) => person(ages[i] ?? 30, earnedIncomes[i] ?? 0));
}

/** A seeded, deterministic generator of well-formed `FederalTaxInput`s covering every filing
 * status, a wide income range (including zero), both preferential and ordinary income, ages
 * spanning the 65 threshold, and years spanning the supported range — so a failure is replayable
 * from the printed seed and index rather than being a one-off flake. */
function makeRandomInputs(seed: number, count: number): FederalTaxInput[] {
  const rand = createSeededRandom(seed);
  const inputs: FederalTaxInput[] = [];

  for (let i = 0; i < count; i++) {
    const status = STATUSES[Math.floor(rand() * STATUSES.length)];
    const year = 2026 + Math.floor(rand() * 100); // 2026-2125
    const ordinaryIncome = Math.floor(rand() * 900_000);
    const preferentialIncome = Math.floor(rand() * 900_000);
    const ages = Array.from({ length: PEOPLE_COUNT[status] }, () => Math.floor(rand() * 90));
    // Earned income is a subset tag of ordinaryIncome (types.ts) — the SUM across people must
    // stay <= ordinaryIncome, so split a single random budget across the household rather than
    // drawing each person's earned income independently up to ordinaryIncome.
    let earnedBudget = Math.floor(rand() * (ordinaryIncome + 1));
    const earnedIncomes = ages.map((_, idx, arr) => {
      if (idx === arr.length - 1) return earnedBudget;
      const share = Math.floor(rand() * (earnedBudget + 1));
      earnedBudget -= share;
      return share;
    });

    inputs.push({
      year,
      filingStatus: status,
      ordinaryIncome,
      preferentialIncome,
      people: makePeople(status, ages, earnedIncomes),
      indexing: INDEXING,
    });
  }

  return inputs;
}

const SEED = 0xfeed1;
const SAMPLE_SIZE = 500;

// ---------------------------------------------------------------------------------------------
// P1 — Tax is monotonically non-decreasing in ordinary income, and in preferential income.
// ---------------------------------------------------------------------------------------------
describe('P1: taxOwed is monotonically non-decreasing in ordinary income and in preferential income', () => {
  it('holds when sweeping ordinaryIncome upward, all else fixed', () => {
    const rand = createSeededRandom(SEED);
    for (let trial = 0; trial < 50; trial++) {
      const status = STATUSES[Math.floor(rand() * STATUSES.length)];
      const ages = Array.from({ length: PEOPLE_COUNT[status] }, () => Math.floor(rand() * 90));
      const preferentialIncome = Math.floor(rand() * 200_000);
      const base = (income: number): FederalTaxInput => ({
        year: 2026,
        filingStatus: status,
        ordinaryIncome: income,
        preferentialIncome,
        people: makePeople(status, ages, ages.map(() => 0)),
        indexing: INDEXING,
      });

      let prevTax = -Infinity;
      for (let income = 0; income <= 500_000; income += 25_000) {
        const { taxOwed } = computeFederalTax(base(income));
        expect(taxOwed, `trial ${trial}, income ${income} (seed ${SEED})`).toBeGreaterThanOrEqual(prevTax);
        prevTax = taxOwed;
      }
    }
  });

  it('holds when sweeping preferentialIncome upward, all else fixed', () => {
    const rand = createSeededRandom(SEED + 1);
    for (let trial = 0; trial < 50; trial++) {
      const status = STATUSES[Math.floor(rand() * STATUSES.length)];
      const ages = Array.from({ length: PEOPLE_COUNT[status] }, () => Math.floor(rand() * 90));
      const ordinaryIncome = Math.floor(rand() * 200_000);
      const base = (income: number): FederalTaxInput => ({
        year: 2026,
        filingStatus: status,
        ordinaryIncome,
        preferentialIncome: income,
        people: makePeople(status, ages, ages.map(() => 0)),
        indexing: INDEXING,
      });

      let prevTax = -Infinity;
      for (let income = 0; income <= 500_000; income += 25_000) {
        const { taxOwed } = computeFederalTax(base(income));
        expect(taxOwed, `trial ${trial}, income ${income} (seed ${SEED + 1})`).toBeGreaterThanOrEqual(prevTax);
        prevTax = taxOwed;
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------
// P2 — ordinaryBracketRate is non-decreasing in income. True of it only, false of
// effectiveMarginalRate (see P4's explicit non-monotonicity property below).
// ---------------------------------------------------------------------------------------------
describe('P2: ordinaryBracketRate is non-decreasing in ordinary income', () => {
  it('holds across a sweep for every filing status, including through the senior-bonus phase-out', () => {
    for (const status of STATUSES) {
      const ages = Array.from({ length: PEOPLE_COUNT[status] }, () => 65); // exercise senior bonus
      let prevRate = -Infinity;
      for (let income = 0; income <= 900_000; income += 10_000) {
        const { ordinaryBracketRate } = computeFederalTax({
          year: 2026,
          filingStatus: status,
          ordinaryIncome: income,
          preferentialIncome: 0,
          people: makePeople(status, ages, ages.map(() => 0)),
          indexing: INDEXING,
        });
        expect(ordinaryBracketRate, `status ${status}, income ${income}`).toBeGreaterThanOrEqual(prevRate);
        prevRate = ordinaryBracketRate;
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------
// P3, restated (ERD round-1 correction): swept over taxableOrdinaryIncome, ordinaryBracketRate
// changes only at statutory band boundaries, and changes AT the boundary (half-open [lower,
// upper) convention) rather than one dollar above or below it.
//
// The original P3 ("swept over ordinaryIncome, rate changes only at statutory boundaries") is
// unwritable as worded: taxableOrdinaryIncome = ordinaryIncome - deduction.total, so in the
// ordinaryIncome coordinate the rate change point is shifted by the deduction, not at the
// statutory boundary itself. This test sweeps taxableOrdinaryIncome directly by holding age < 65
// (fixed deduction, no senior bonus) and setting ordinaryIncome = boundary + deduction.total.
// ---------------------------------------------------------------------------------------------
describe('P3 (restated): ordinaryBracketRate changes only AT statutory band boundaries, in taxableOrdinaryIncome coordinates', () => {
  it('is exactly the [lower, upper) convention at every band boundary, every filing status', () => {
    for (const status of STATUSES) {
      const ages = Array.from({ length: PEOPLE_COUNT[status] }, () => 30); // no senior bonus
      const people = makePeople(status, ages, ages.map(() => 0));

      // Learn this status/year's fixed deduction.total (age < 65, so it never depends on income).
      const probe = computeFederalTax({
        year: 2026,
        filingStatus: status,
        ordinaryIncome: 0,
        preferentialIncome: 0,
        people,
        indexing: INDEXING,
      });
      const deductionTotal = probe.deduction.total;
      const boundaries = probe.ordinaryBrackets
        .map((b) => b.lowerBound)
        .filter((b) => b > 0);

      const rateAt = (taxableOrdinaryIncome: number): number =>
        computeFederalTax({
          year: 2026,
          filingStatus: status,
          ordinaryIncome: taxableOrdinaryIncome + deductionTotal,
          preferentialIncome: 0,
          people,
          indexing: INDEXING,
        }).ordinaryBracketRate;

      for (const boundary of boundaries) {
        if (boundary === Infinity) continue;
        const below = rateAt(boundary - 1);
        const at = rateAt(boundary);
        const above = rateAt(boundary + 1);
        expect(below, `status ${status}, boundary ${boundary} - 1`).toBeLessThan(at);
        expect(at, `status ${status}, boundary ${boundary}`).toBe(above);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------
// P4, restated (ERD round-1 correction): effectiveMarginalRate is NOT monotone — an explicit
// pinned pair straddling the senior-bonus phase-out END where the rate FALLS as income rises.
//
// The originally-worded P4 ("a pair strictly INSIDE the phase-out where the rate falls") is
// false: inside the phase-out, effectiveMarginalRate = ordinaryBracketRate * 1.06 for a single
// qualifying taxpayer, and a non-decreasing quantity (P2) times a positive constant is
// non-decreasing. A sweep strictly inside the phase-out finds zero falling pairs. Restated to the
// boundary the bonus's expiry actually produces: the fall happens on the way OUT of the
// phase-out, not inside it.
// ---------------------------------------------------------------------------------------------
describe('P4 (restated): effectiveMarginalRate falls across the senior-bonus phase-out END boundary', () => {
  it('falls from 0.2544 to 0.24 exactly at the pinned single/2026/age-65+ pair (174,999 -> 175,000)', () => {
    const base = (ordinaryIncome: number): FederalTaxInput => ({
      year: 2026,
      filingStatus: 'single',
      ordinaryIncome,
      preferentialIncome: 0,
      people: [person(65, 0)],
      indexing: INDEXING,
    });

    const justBelow = computeFederalTax(base(174_999));
    const at = computeFederalTax(base(175_000));

    expect(justBelow.effectiveMarginalRate).toBeCloseTo(0.2544, 6);
    expect(at.effectiveMarginalRate).toBeCloseTo(0.24, 6);
    expect(at.effectiveMarginalRate).toBeLessThan(justBelow.effectiveMarginalRate);
  });

  it('does NOT fall anywhere strictly inside the phase-out (confirms the original P4 wording was unwritable)', () => {
    // phaseOutStart=75_000, phaseOutEnd=175_000 for single. Strictly inside: (75_000, 175_000).
    let prevRate = -Infinity;
    for (let income = 75_001; income < 175_000; income += 5_000) {
      const { effectiveMarginalRate } = computeFederalTax({
        year: 2026,
        filingStatus: 'single',
        ordinaryIncome: income,
        preferentialIncome: 0,
        people: [person(65, 0)],
        indexing: INDEXING,
      });
      // 1e-9 tolerance for floating-point noise in the finite-difference computation itself
      // (§6.2.2's epsilon convention), not a relaxation of the property.
      expect(effectiveMarginalRate, `income ${income}`).toBeGreaterThanOrEqual(prevRate - 1e-9);
      prevRate = effectiveMarginalRate;
    }
  });
});

// ---------------------------------------------------------------------------------------------
// P5 — "effective rate never exceeds marginal rate" — asserted ONLY as
// effectiveRate <= effectiveMarginalRate. Per §6.2.1, this is false against two of the three
// natural readings; those falsifications are recorded below as comments (with a concrete
// regression test each) so nobody re-broadens the property later. The one true reading is swept.
// ---------------------------------------------------------------------------------------------
describe('P5: effectiveRate never exceeds effectiveMarginalRate (the one true reading)', () => {
  it('holds across a wide random sweep (not proven in general per §6.2.1 — swept, not proved)', () => {
    const inputs = makeRandomInputs(SEED + 2, SAMPLE_SIZE);
    inputs.forEach((input, i) => {
      const result = computeFederalTax(input);
      expect(
        result.effectiveRate,
        `index ${i} (seed ${SEED + 2}): ${JSON.stringify(input)}`,
      ).toBeLessThanOrEqual(result.effectiveMarginalRate + 1e-9);
    });
  });
});

describe('P5 falsifications recorded per §6.2.1 (NOT properties — do not re-broaden P5 to cover these)', () => {
  it('FALSE if the effective rate includes FICA: single 2026, $30,000 earned income, no preferential income', () => {
    // $12,400 @ 10% + $1,500 @ 12% = $1,420 income tax (std deduction $16,100 -> $13,900 taxable),
    // plus $2,295 FICA = $3,715 total -> a 12.4% burden against a 12% ordinaryBracketRate.
    // This is why effectiveRateIncludingFica is explicitly excluded from P5 (types.ts doc comment).
    const result = computeFederalTax({
      year: 2026,
      filingStatus: 'single',
      ordinaryIncome: 30_000,
      preferentialIncome: 0,
      people: [person(30, 30_000)],
      indexing: INDEXING,
    });

    expect(result.taxOwed).toBe(1_420);
    expect(result.fica.total).toBe(2_295);
    expect(result.ordinaryBracketRate).toBeCloseTo(0.12, 9);
    expect(result.effectiveRateIncludingFica).toBeGreaterThan(result.ordinaryBracketRate);
  });

  it('FALSE against ordinaryBracketRate on all-preferential income: single 2026, $0 ordinary, $700,000 preferential', () => {
    // deduction $16,100 -> shift = -16,100 -> shifted bands [0, 65,550) @ 0%, then 15%, then 20%,
    // giving $102,087.50 of tax before rounding -> an effective rate of ~14.58% against an
    // ordinaryBracketRate of 10% (the rate the first ordinary dollar would face at zero income).
    const result = computeFederalTax({
      year: 2026,
      filingStatus: 'single',
      ordinaryIncome: 0,
      preferentialIncome: 700_000,
      people: [person(30, 0)],
      indexing: INDEXING,
    });

    expect(result.ordinaryBracketRate).toBeCloseTo(0.1, 9);
    expect(result.effectiveRate).toBeGreaterThan(result.ordinaryBracketRate);
    expect(result.effectiveRate).toBeCloseTo(0.1458, 3);
  });
});

// ---------------------------------------------------------------------------------------------
// P6 — Tax is never negative, across every relevant field.
// ---------------------------------------------------------------------------------------------
describe('P6: no tax-related field is ever negative', () => {
  it('holds across a wide random sweep', () => {
    const inputs = makeRandomInputs(SEED + 3, SAMPLE_SIZE);
    inputs.forEach((input, i) => {
      const result = computeFederalTax(input);
      const label = `index ${i} (seed ${SEED + 3})`;
      expect(result.taxOwed, label).toBeGreaterThanOrEqual(0);
      expect(result.ordinaryTax, label).toBeGreaterThanOrEqual(0);
      expect(result.preferentialTax, label).toBeGreaterThanOrEqual(0);
      expect(result.taxBeforeCredits, label).toBeGreaterThanOrEqual(0);
      expect(result.fica.socialSecurity, label).toBeGreaterThanOrEqual(0);
      expect(result.fica.medicare, label).toBeGreaterThanOrEqual(0);
      expect(result.fica.additionalMedicare, label).toBeGreaterThanOrEqual(0);
      expect(result.fica.total, label).toBeGreaterThanOrEqual(0);
      result.ordinaryBrackets.forEach((b, j) =>
        expect(b.taxFromThisBracket, `${label}, ordinaryBrackets[${j}]`).toBeGreaterThanOrEqual(0),
      );
      result.preferentialBrackets.forEach((b, j) =>
        expect(b.taxFromThisBracket, `${label}, preferentialBrackets[${j}]`).toBeGreaterThanOrEqual(0),
      );
    });
  });
});

// ---------------------------------------------------------------------------------------------
// P7 / P8 — sum(bracket taxFromThisBracket) is within $1 of the rounded ordinaryTax/preferentialTax
// (ERD §6.2.2: $1 is the exact bound implied by §5.7's rule, not a fudge factor).
// ---------------------------------------------------------------------------------------------
describe('P7: sum(ordinaryBrackets[].taxFromThisBracket) is within $1 of ordinaryTax', () => {
  it('holds across a wide random sweep', () => {
    const inputs = makeRandomInputs(SEED + 4, SAMPLE_SIZE);
    inputs.forEach((input, i) => {
      const result = computeFederalTax(input);
      const sum = result.ordinaryBrackets.reduce((s, b) => s + b.taxFromThisBracket, 0);
      expect(Math.abs(sum - result.ordinaryTax), `index ${i} (seed ${SEED + 4})`).toBeLessThanOrEqual(1);
    });
  });
});

describe('P8: sum(preferentialBrackets[].taxFromThisBracket) is within $1 of preferentialTax', () => {
  it('holds across a wide random sweep', () => {
    const inputs = makeRandomInputs(SEED + 5, SAMPLE_SIZE);
    inputs.forEach((input, i) => {
      const result = computeFederalTax(input);
      const sum = result.preferentialBrackets.reduce((s, b) => s + b.taxFromThisBracket, 0);
      expect(Math.abs(sum - result.preferentialTax), `index ${i} (seed ${SEED + 5})`).toBeLessThanOrEqual(1);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// P9 — when preferentialIncome === 0, ordinaryTax equals the rounded bracket sum EXACTLY (no
// tolerance): with no preferential income there is nothing for allocateRounding to allocate away
// from ordinaryTax, so it is simply roundHalfUp of the bracket sum.
// ---------------------------------------------------------------------------------------------
describe('P9: ordinaryTax === Math.round(sum(ordinaryBrackets[].taxFromThisBracket)) when preferentialIncome === 0', () => {
  it('holds exactly across a wide random sweep', () => {
    const inputs = makeRandomInputs(SEED + 6, SAMPLE_SIZE).map((input) => ({
      ...input,
      preferentialIncome: 0,
    }));
    inputs.forEach((input, i) => {
      const result = computeFederalTax(input);
      const sum = result.ordinaryBrackets.reduce((s, b) => s + b.taxFromThisBracket, 0);
      expect(result.ordinaryTax, `index ${i} (seed ${SEED + 6})`).toBe(Math.round(sum));
    });
  });
});

// ---------------------------------------------------------------------------------------------
// P10 / P11 — bracket occupancy sums match their defining totals within 1e-9 (matching the
// epsilon convention errors.ts already uses for ALLOCATION_SUM_INVALID).
// ---------------------------------------------------------------------------------------------
describe('P10: sum(ordinaryBrackets[].incomeInThisBracket) === taxableOrdinaryIncome within 1e-9', () => {
  it('holds across a wide random sweep', () => {
    const inputs = makeRandomInputs(SEED + 7, SAMPLE_SIZE);
    inputs.forEach((input, i) => {
      const result = computeFederalTax(input);
      const sum = result.ordinaryBrackets.reduce((s, b) => s + b.incomeInThisBracket, 0);
      expect(Math.abs(sum - result.taxableOrdinaryIncome), `index ${i} (seed ${SEED + 7})`).toBeLessThan(1e-9);
    });
  });
});

describe('P11: sum(preferentialBrackets[].incomeInThisBracket) === grossPreferentialIncome within 1e-9 (NOT taxablePreferentialIncome)', () => {
  it('holds across a wide random sweep', () => {
    const inputs = makeRandomInputs(SEED + 8, SAMPLE_SIZE);
    inputs.forEach((input, i) => {
      const result = computeFederalTax(input);
      const sum = result.preferentialBrackets.reduce((s, b) => s + b.incomeInThisBracket, 0);
      expect(Math.abs(sum - result.grossPreferentialIncome), `index ${i} (seed ${SEED + 8})`).toBeLessThan(1e-9);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// P12 — ordinaryTax + preferentialTax === taxBeforeCredits, and taxBeforeCredits - credits ===
// taxOwed, both as EXACT integer equality (no epsilon).
// ---------------------------------------------------------------------------------------------
describe('P12: ordinaryTax + preferentialTax === taxBeforeCredits, and taxBeforeCredits - credits === taxOwed', () => {
  it('holds exactly across a wide random sweep', () => {
    const inputs = makeRandomInputs(SEED + 9, SAMPLE_SIZE);
    inputs.forEach((input, i) => {
      const result = computeFederalTax(input);
      const label = `index ${i} (seed ${SEED + 9})`;
      expect(result.ordinaryTax + result.preferentialTax, label).toBe(result.taxBeforeCredits);
      expect(result.taxBeforeCredits - result.credits, label).toBe(result.taxOwed);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// P13 — fica.socialSecurity + fica.medicare + fica.additionalMedicare === fica.total, EXACT.
// ---------------------------------------------------------------------------------------------
describe('P13: fica.socialSecurity + fica.medicare + fica.additionalMedicare === fica.total', () => {
  it('holds exactly across a wide random sweep', () => {
    const inputs = makeRandomInputs(SEED + 10, SAMPLE_SIZE);
    inputs.forEach((input, i) => {
      const result = computeFederalTax(input);
      expect(
        result.fica.socialSecurity + result.fica.medicare + result.fica.additionalMedicare,
        `index ${i} (seed ${SEED + 10})`,
      ).toBe(result.fica.total);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// P14 — Moving a dollar from ordinary to preferential income never *increases* taxOwed.
// ---------------------------------------------------------------------------------------------
describe('P14: shifting a dollar from ordinary to preferential income never increases taxOwed', () => {
  it('holds across a wide random sweep of income splits', () => {
    const rand = createSeededRandom(SEED + 11);
    for (let trial = 0; trial < SAMPLE_SIZE; trial++) {
      const status = STATUSES[Math.floor(rand() * STATUSES.length)];
      const total = Math.floor(rand() * 900_000);
      const ordinaryIncome = Math.floor(rand() * (total + 1));
      const preferentialIncome = total - ordinaryIncome;
      if (ordinaryIncome < 1) continue; // nothing to shift
      const ages = Array.from({ length: PEOPLE_COUNT[status] }, () => Math.floor(rand() * 90));
      const people = makePeople(status, ages, ages.map(() => 0));

      const before = computeFederalTax({
        year: 2026,
        filingStatus: status,
        ordinaryIncome,
        preferentialIncome,
        people,
        indexing: INDEXING,
      });
      const after = computeFederalTax({
        year: 2026,
        filingStatus: status,
        ordinaryIncome: ordinaryIncome - 1,
        preferentialIncome: preferentialIncome + 1,
        people,
        indexing: INDEXING,
      });

      expect(
        after.taxOwed,
        `trial ${trial} (seed ${SEED + 11}): status=${status} ordinary=${ordinaryIncome} preferential=${preferentialIncome}`,
      ).toBeLessThanOrEqual(before.taxOwed);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// P15 — Both rate fields are 0, never NaN, at zero income.
// ---------------------------------------------------------------------------------------------
describe('P15: effectiveRate and effectiveMarginalRate are 0 (never NaN) at zero income', () => {
  it('holds for every filing status at zero ordinary and preferential income', () => {
    for (const status of STATUSES) {
      const ages = Array.from({ length: PEOPLE_COUNT[status] }, () => 30);
      const result = computeFederalTax({
        year: 2026,
        filingStatus: status,
        ordinaryIncome: 0,
        preferentialIncome: 0,
        people: makePeople(status, ages, ages.map(() => 0)),
        indexing: INDEXING,
      });
      expect(result.effectiveRate, status).toBe(0);
      expect(Number.isNaN(result.effectiveRate), status).toBe(false);
      // Per the ERD's property table and FederalTaxResult.effectiveMarginalRate doc comment,
      // both rate fields must be exactly 0 (never NaN) at zero income.
      expect(result.effectiveMarginalRate, status).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// P16 — Frozen thresholds do not move across years: the Additional Medicare threshold resolved
// for 2026 equals the one resolved for 2125, for every status and any indexing rates.
// ---------------------------------------------------------------------------------------------
describe('P16: the Additional Medicare threshold is frozen across the full supported year range', () => {
  it('is identical between 2026 and 2125, every status, for any indexing rates', () => {
    const rand = createSeededRandom(SEED + 12);
    for (const status of STATUSES) {
      for (let trial = 0; trial < 10; trial++) {
        const indexing = { chainedCpiU: rand() * 0.2 - 0.05, averageWageIndex: rand() * 0.2 - 0.05 };

        const early = resolveTables(2026, status, indexing);
        const late = resolveTables(2125, status, indexing);

        expect(
          late.fica.additionalMedicareThreshold,
          `status ${status}, trial ${trial}, indexing ${JSON.stringify(indexing)}`,
        ).toBe(early.fica.additionalMedicareThreshold);
      }
    }
  });
});
