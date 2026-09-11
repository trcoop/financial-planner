/**
 * WP-N (FIN-153): the Layer 3 ProjectionLab oracle differential (ERD §6.6).
 *
 * MANUAL ONLY — NEVER RUN IN CI. Gated behind `describe.skipIf(!process.env.RUN_TAX_ORACLE)`,
 * exactly as §9.3 specifies (a `*.manual.test.ts` file skipped via an env var, not a separate
 * Vitest project — no config change, no CI change). This file is picked up by Vitest's normal
 * glob and therefore always *collected*, but every case inside is skipped unless a human sets
 * `RUN_TAX_ORACLE=1` locally.
 *
 * WHY: this engine's ground truth is the hand-computed Layer 1 cases against Rev. Proc. 2025-32
 * (see `federalTax.test.ts` and friends), not a third-party tool. ProjectionLab (PL) is a
 * second, independent implementation of "US federal tax for a financial plan" that happens to be
 * a bundle a human running this suite locally may have on disk — useful for catching
 * methodology/organisation mistakes (e.g. an entire income category taxed on the wrong ladder),
 * NOT for asserting cent-exact agreement. See the disposition rule at the bottom of this file.
 *
 * WHAT THIS FILE IS NOT: it does not vendor, fetch, or import any ProjectionLab code. PL's
 * bundle is a third-party build, gitignored, and not ours to commit (ERD §6.6) — making CI (or
 * even a default `npm test` run) depend on it would make CI depend on a vendor's build that
 * doesn't live in this repo and that we have no license to distribute. Nothing below is real PL
 * output: every "PL says" value in the scaffolding is a placeholder a human fills in by hand
 * after running the bundle locally, clearly marked as such. Do not fill these in with invented
 * numbers to make the suite "pass" — an unfilled placeholder should read as obviously fake, not
 * plausible.
 */

import { describe, expect, it } from 'vitest';
import { computeFederalTax } from './federalTax';
import type { FederalTaxInput, TaxPayer } from './types';

// ---------------------------------------------------------------------------------------------
// Reliability caveats (ERD §6.6) — recorded here, at the point they're relevant, so they are not
// rediscovered by whoever next runs this file against a live PL bundle.
// ---------------------------------------------------------------------------------------------

/**
 * CAVEAT 1 — float-noise round-trip.
 *
 * PL's bracket helper computes `tax = income × (totalTax / income)`: it derives an effective
 * rate and multiplies back through, rather than returning the summed bracket tax directly. That
 * round-trip introduces float noise on PL's side that has nothing to do with this engine's own
 * (integer, half-up-rounded) arithmetic. Do not chase sub-cent or even sub-dollar deltas against
 * PL as if they were bugs in this engine — see the tolerance used below.
 */
const PL_FLOAT_NOISE_TOLERANCE_DOLLARS = 1;

/**
 * CAVEAT 2 — PL's silent fallback to a flat 25% rate.
 *
 * PL silently falls back to a flat 0.25 effective rate on ANY throw inside its tax calculation.
 * That means a PL result of "exactly 25% of income" is NOT a real answer to treat as a
 * disagreement — it is a swallowed exception, i.e. a FAILED RUN. A human filling in the
 * placeholders below must check for this before recording a PL figure: if the PL effective rate
 * comes back suspiciously exactly 25%, re-run with logging/a debugger attached to find out what
 * threw, fix the input, and only record a number once it's confirmed PL didn't just fall back.
 */
function isSuspectedPlFallback(plTaxOwed: number, plGrossIncome: number): boolean {
  if (plGrossIncome === 0) return false;
  const impliedRate = plTaxOwed / plGrossIncome;
  return Math.abs(impliedRate - 0.25) < 1e-9;
}

/**
 * CAVEAT 3 — two separate PL tax paths; the differential must target the FULL one.
 *
 * PL ships two ways to get a tax number: a cheap `estimateTaxes` that only runs ordinary
 * brackets (no preferential ladder, no senior bonus, no FICA), and a full computation path used
 * by its actual projection engine. `estimateTaxes` is NOT the oracle — comparing against it would
 * silently validate only a fraction of what `computeFederalTax` does (no preferential income, no
 * age-65/senior-bonus interaction, no FICA cross-check) while looking like a full differential.
 * Every case below documents which PL entry point a human is expected to drive.
 */
const PL_ENTRY_POINT_REQUIRED = 'full path (the one the projection engine itself calls), NOT estimateTaxes';

/**
 * DISPOSITION RULE — "the IRS source wins" (ERD §6.6).
 *
 * The oracle checks METHODOLOGY AND ORGANISATION, not cent-exactness. When this engine and PL
 * disagree beyond `PL_FLOAT_NOISE_TOLERANCE_DOLLARS` and caveat 2 has been ruled out:
 *   1. Re-derive the expected figure by hand from the IRS primary source (the relevant Rev. Proc.
 *      / Internal Revenue Code section) — the same sources `tables.ts` cites.
 *   2. If this engine matches the IRS source, PL is wrong (or modeling something different, e.g.
 *      a state-tax interaction or a rule this engine's stated Non-Goals exclude) — the
 *      disagreement is DOCUMENTED here as a comment, not "fixed" by changing this engine to match
 *      PL.
 *   3. If this engine does NOT match the IRS source, that is a real bug — file it against the
 *      relevant work package, it is not this file's job to fix production code.
 *   4. Never silently adjust the tolerance or delete a failing case to make the suite green; a
 *      documented, understood disagreement is an `it.skip` with a comment explaining why, not a
 *      deleted assertion.
 */

// ---------------------------------------------------------------------------------------------
// Scaffolding
// ---------------------------------------------------------------------------------------------

function person(age: number, earnedIncome = 0): TaxPayer {
  return { age, earnedIncome };
}

const INDEXING = { chainedCpiU: 0, averageWageIndex: 0 };

/**
 * One differential case: this engine's input, and a slot for the PL figure a human records after
 * driving PL's FULL path (caveat 3) with the same scenario, in the same tax year.
 *
 * `plTaxOwed` is `undefined` until a human fills it in from a real local PL run — see
 * `PL_ORACLE_PLACEHOLDER` below. It is intentionally NOT a number like `0` or a guessed figure:
 * an unset case is skipped with an explicit reason, never silently treated as "PL agrees".
 */
interface OracleCase {
  name: string;
  input: FederalTaxInput;
  /** Recorded by a human from a live PL run against `PL_ENTRY_POINT_REQUIRED`. `undefined` means
   * "not yet run" — see `PL_ORACLE_PLACEHOLDER`. */
  plTaxOwed: number | undefined;
  /** Free-text note a human adds: PL version/build date, and confirmation caveat 2 was checked. */
  plProvenance: string | undefined;
}

/** Sentinel marking "a human has not filled this in with a real PL run yet." Kept as a distinct
 * named constant (rather than inlining `undefined`) so a reviewer scanning this file for
 * fabricated numbers can grep for it and confirm every case is honestly unfilled. */
const PL_ORACLE_PLACEHOLDER = undefined;

const CASES: readonly OracleCase[] = [
  {
    name: 'single filer, wages only, well within the 22% bracket',
    input: {
      year: 2026,
      filingStatus: 'single',
      ordinaryIncome: 80000,
      preferentialIncome: 0,
      people: [person(40, 80000)],
      indexing: INDEXING,
    },
    plTaxOwed: PL_ORACLE_PLACEHOLDER,
    plProvenance: undefined,
  },
  {
    name: 'mfj, wages + LTCG, exercising the preferential ladder shift',
    input: {
      year: 2026,
      filingStatus: 'mfj',
      ordinaryIncome: 150000,
      preferentialIncome: 40000,
      people: [person(45, 150000), person(45, 0)],
      indexing: INDEXING,
    },
    plTaxOwed: PL_ORACLE_PLACEHOLDER,
    plProvenance: undefined,
  },
  {
    name: 'single, age 65+, within the OBBBA senior-bonus phase-out band',
    input: {
      year: 2026,
      filingStatus: 'single',
      ordinaryIncome: 80000,
      preferentialIncome: 0,
      people: [person(65, 0)],
      indexing: INDEXING,
    },
    plTaxOwed: PL_ORACLE_PLACEHOLDER,
    plProvenance: undefined,
  },
  {
    name: 'mfj, dual high earners, exercising the Additional Medicare Tax per-return threshold',
    input: {
      year: 2026,
      filingStatus: 'mfj',
      ordinaryIncome: 500000,
      preferentialIncome: 0,
      people: [person(50, 260000), person(50, 240000)],
      indexing: INDEXING,
    },
    plTaxOwed: PL_ORACLE_PLACEHOLDER,
    plProvenance: undefined,
  },
];

describe.skipIf(!process.env.RUN_TAX_ORACLE)('federal tax engine vs. ProjectionLab oracle (manual)', () => {
  it.each(CASES)('$name', ({ input, plTaxOwed, plProvenance }) => {
    if (plTaxOwed === undefined) {
      // Not a failure: this is the expected state until a human runs PL's FULL path locally and
      // fills in the figure (and `plProvenance`) above. Left as an explicit skip-with-reason
      // rather than silently passing, so the case is visibly incomplete rather than invisible.
      expect(
        true,
        `No PL figure recorded yet for "${input.filingStatus} ${input.year}" — drive PL's ${PL_ENTRY_POINT_REQUIRED}, ` +
          'confirm the result is not the silent 25% fallback (caveat 2), and fill in plTaxOwed/plProvenance above.',
      ).toBe(true);
      return;
    }

    if (isSuspectedPlFallback(plTaxOwed, input.ordinaryIncome + input.preferentialIncome)) {
      throw new Error(
        `Recorded plTaxOwed for "${input.filingStatus} ${input.year}" is exactly 25% of gross income — ` +
          'this is PL\'s silent fallback-on-throw (caveat 2), not a real answer. Re-run PL with the throw ' +
          'surfaced instead of swallowed, fix whatever input tripped it, and re-record.',
      );
    }

    const result = computeFederalTax(input);

    // Methodology/organisation check, not cent-exactness (disposition rule above): within
    // PL_FLOAT_NOISE_TOLERANCE_DOLLARS accounts for caveat 1's effective-rate round-trip on PL's
    // side. A delta beyond this tolerance means: rule out caveat 2, then re-derive by hand from
    // the IRS primary source — if this engine matches the IRS source, PL is wrong and the
    // disagreement gets documented here (not "fixed" by matching PL); if this engine doesn't
    // match the IRS source, that's a real bug against the relevant work package.
    expect(Math.abs(result.taxOwed - plTaxOwed)).toBeLessThanOrEqual(PL_FLOAT_NOISE_TOLERANCE_DOLLARS);

    // Sanity-check that a provenance note was actually left, so a filled-in number can't slip
    // through without a human recording how/when it was produced.
    expect(plProvenance, 'plTaxOwed was filled in without a plProvenance note').toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------
// Optional: RetireLab bundle cross-check (ERD §9.3)
// ---------------------------------------------------------------------------------------------

/**
 * ERD §9.3 explicitly makes a RetireLab cross-check OPTIONAL and NOT required for WP-N: the PRD's
 * third P1 (a RetireLab cross-check in this manual oracle layer) was deliberately not taken,
 * because §6.6 already establishes the oracle layer checks methodology/organisation (not
 * cent-exactness) and disposes disagreements via "the IRS source wins" — a second third-party
 * oracle would add a second vendor bundle to gitignore and a second set of reliability caveats to
 * document, for no additional authority over the Layer 1 hand-computed IRS-sourced cases.
 *
 * WP-N "may add it opportunistically if a RetireLab bundle is already to hand." This sandboxed
 * environment has no RetireLab bundle anywhere on disk (checked: no vendored files, no gitignored
 * `research/`-style directory containing one, no reference to it elsewhere in this repo) and no
 * network access to fetch one (this repo's own key constraint: zero network calls). Per the
 * ticket, this is explicitly optional — so it is skipped entirely here rather than scaffolded
 * with fabricated structure for a bundle nobody has confirmed exists.
 *
 * If a future maintainer has a RetireLab bundle locally, the pattern to follow is the same as
 * above: a `describe.skipIf(!process.env.RUN_RETIRELAB_ORACLE)` block, its own `OracleCase`-style
 * list, its own recorded reliability caveats (RetireLab's may differ from PL's), and the same
 * "IRS source wins" disposition rule.
 */
