/**
 * `ssTables.fixture`: the pinned reference-table generator (ERD §6, §12.5). Deliberately shares NO
 * helper, constant or formula shape with `benefit.ts`: it re-derives every factor with an explicit
 * month-by-month loop in exact integer arithmetic (units of 1/3600 of PIA, so 5/9 % = 20, 5/12 % = 15,
 * 2/3 % = 24), so tests asserting code == generator catch drift in either side.
 *
 * Emits (i) the STEADY table (7 distinct FRA cohorts x 96 claim months 62y1m..70y0m = 672 rows) and
 * (ii) the INITIAL-factor table for every (FRA cohort x birth month 1-12 x claim month) = 8,064 cases.
 * "Initial" = the factor payable in the claim month: delayed credits count only for months that fall
 * entirely before the claim year's January, unless the claim is at 70y0m (all credits immediately).
 */

/** One representative birth year per FRA cohort, with that cohort's FRA in months (ERD §4). */
const COHORTS: readonly { birthYear: number; fraMonths: number }[] = [
  { birthYear: 1954, fraMonths: 792 },
  { birthYear: 1955, fraMonths: 794 },
  { birthYear: 1956, fraMonths: 796 },
  { birthYear: 1957, fraMonths: 798 },
  { birthYear: 1958, fraMonths: 800 },
  { birthYear: 1959, fraMonths: 802 },
  { birthYear: 1960, fraMonths: 804 },
];

const FIRST_CLAIM_AGE = 745; // 62y1m
const LAST_CLAIM_AGE = 840; // 70y0m
const UNIT = 3600; // 100% of PIA

export interface SteadyRow {
  fraMonths: number;
  claimAge: number;
  factor: number;
}

export interface InitialRow {
  birthYear: number;
  birthMonth: number;
  fraMonths: number;
  claimAge: number;
  /** Factor payable in the claim month (January rule). */
  factor: number;
  /** Factor from the January after the claim year onward. */
  steadyFactor: number;
}

/** Early-claim numerator: walk back one month at a time from the FRA. */
function earlyNumerator(fra: number, claimAge: number): number {
  let n = UNIT;
  for (let age = fra; age > claimAge; age--) {
    const monthsEarlySoFar = fra - age; // 0-based index of this reduction month
    n -= monthsEarlySoFar < 36 ? 20 : 15;
  }
  return n;
}

function steadyNumerator(fra: number, claimAge: number): number {
  if (claimAge <= fra) return earlyNumerator(fra, claimAge);
  let n = UNIT;
  for (let age = fra; age < claimAge; age++) n += 24;
  return n;
}

export function ssTablesFixture(): { steady: SteadyRow[]; initial: InitialRow[] } {
  const steady: SteadyRow[] = [];
  const initial: InitialRow[] = [];
  for (const { birthYear, fraMonths } of COHORTS) {
    for (let claimAge = FIRST_CLAIM_AGE; claimAge <= LAST_CLAIM_AGE; claimAge++) {
      steady.push({ fraMonths, claimAge, factor: steadyNumerator(fraMonths, claimAge) / UNIT });
    }
    for (let birthMonth = 1; birthMonth <= 12; birthMonth++) {
      const birthIdx = birthYear * 12 + (birthMonth - 1);
      for (let claimAge = FIRST_CLAIM_AGE; claimAge <= LAST_CLAIM_AGE; claimAge++) {
        const claimIdx = birthIdx + claimAge;
        const claimYear = Math.floor(claimIdx / 12);
        let n: number;
        if (claimAge <= fraMonths) {
          n = earlyNumerator(fraMonths, claimAge);
        } else {
          n = UNIT;
          // A credit month is a month from the FRA month up to (excluding) the claim month. While the
          // claim year is running, only months ending on or before December of the prior year count.
          for (let month = birthIdx + fraMonths; month < claimIdx; month++) {
            const endsBeforeClaimYear = month + 1 <= claimYear * 12 - 1;
            if (claimAge >= LAST_CLAIM_AGE || endsBeforeClaimYear) n += 24;
          }
        }
        initial.push({
          birthYear,
          birthMonth,
          fraMonths,
          claimAge,
          factor: n / UNIT,
          steadyFactor: steadyNumerator(fraMonths, claimAge) / UNIT,
        });
      }
    }
  }
  return { steady, initial };
}
