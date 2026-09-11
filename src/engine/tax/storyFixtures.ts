/**
 * WP-F (added engineering review round 1, 2026-09-09): the pinned story `indexing` constant plus
 * six named `FederalTaxInput` literals, so the two chart packages (WP-J's bracket ladder, WP-K's
 * tax waterfall) render the SAME six scenarios from one source rather than each writing their own
 * and drifting.
 *
 * No arithmetic here — imports `types.ts` only, never `tables.ts`. Exported from
 * `src/engine/tax/index.ts` (this package's barrel) but deliberately NOT promoted to
 * `src/engine/index.ts`, so story scaffolding never enters the engine's documented public
 * surface (ERD §3, round-1 correction (a)).
 */

import type { FederalTaxInput, IndexingRates } from './types';

/** Shared indexing rates for every story scenario, all of which use `year: 2026` (a published
 * actual), so these are never actually consulted by `resolveTables` — pinned anyway so the
 * literal is well-formed and the story author has one obvious value to reach for. */
export const STORY_INDEXING: IndexingRates = {
  chainedCpiU: 0.025,
  averageWageIndex: 0.03,
};

/** The six named scenarios §8.5 requires both chart components to render. */
export type StoryScenarioName =
  | 'ZeroTax'
  | 'MiddleIncome'
  | 'TopBracket'
  | 'PreferentialHeavy'
  | 'Age65Single'
  | 'SeniorBonusPhaseOut';

/**
 * One `FederalTaxInput` literal per named scenario. Each is asserted, in
 * `storyFixtures.test.ts`, against the SPECIFIC property it exists to demonstrate (ERD §10.2,
 * round-2 clarification finding 3) — not against a snapshot, since a Playwright baseline proves
 * only that the picture did not change, never that it is still the right picture.
 */
export const STORY_FIXTURES: Readonly<Record<StoryScenarioName, FederalTaxInput>> = {
  /** Below the standard deduction: proves `taxOwed === 0`. */
  ZeroTax: {
    year: 2026,
    filingStatus: 'single',
    ordinaryIncome: 10_000,
    preferentialIncome: 0,
    people: [{ age: 30, earnedIncome: 10_000 }],
    indexing: STORY_INDEXING,
  },
  /** Comfortably into the ordinary ladder: proves at least 3 occupied ordinary bands. */
  MiddleIncome: {
    year: 2026,
    filingStatus: 'single',
    ordinaryIncome: 120_000,
    preferentialIncome: 0,
    people: [{ age: 45, earnedIncome: 120_000 }],
    indexing: STORY_INDEXING,
  },
  /** Well above the top statutory bound: proves the `Infinity` band is occupied. */
  TopBracket: {
    year: 2026,
    filingStatus: 'single',
    ordinaryIncome: 900_000,
    preferentialIncome: 0,
    people: [{ age: 50, earnedIncome: 900_000 }],
    indexing: STORY_INDEXING,
  },
  /** Ordinary income at/under the deduction, heavy preferential income: proves
   * `taxableOrdinaryIncome === 0` AND a 0% preferential band wider than the unshifted statutory
   * top (the negative-shift widening of §5.3 step 2 made visible). */
  PreferentialHeavy: {
    year: 2026,
    filingStatus: 'single',
    ordinaryIncome: 10_000,
    preferentialIncome: 400_000,
    people: [{ age: 40, earnedIncome: 10_000 }],
    indexing: STORY_INDEXING,
  },
  /** A single age-65 filer: proves `deduction.ageAddition > 0`. */
  Age65Single: {
    year: 2026,
    filingStatus: 'single',
    ordinaryIncome: 60_000,
    preferentialIncome: 0,
    people: [{ age: 65, earnedIncome: 60_000 }],
    indexing: STORY_INDEXING,
  },
  /** A single age-65 filer with MAGI inside the OBBBA senior-bonus phase-out band
   * ($75,000-$175,000 unmarried): proves `0 < deduction.seniorBonusDeduction < 12_000` (the
   * per-qualifying-person cap for a single filer is $6,000, so a partial phase-out is strictly
   * below that, and strictly below the $12,000 MFJ two-person cap named in the ERD table). */
  SeniorBonusPhaseOut: {
    year: 2026,
    filingStatus: 'single',
    ordinaryIncome: 100_000,
    preferentialIncome: 0,
    people: [{ age: 65, earnedIncome: 100_000 }],
    indexing: STORY_INDEXING,
  },
};
