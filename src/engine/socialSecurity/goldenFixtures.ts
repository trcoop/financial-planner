/**
 * The ONE shared golden fixture spec for the Social Security engine (FIN-163 Round 4/5; ERD §7, §12.4,
 * §12.14, §12.19.1, §12.23). INPUTS ONLY: this file never calls the engine. Downstream tickets
 * (FIN-164/165/167/169/180) import `GOLDEN_FIXTURES[key]` and assert; they never redefine inputs.
 * Adding or changing a key is an edit to FIN-163 first.
 *
 * Conventions: frozen `asOf` 2026-09 (except G11a/b, whose spec fixes asOf in June), COLA 0 unless
 * noted, growth off, birth dates on the 3rd-31st (PRD P5; only month+year are stored), no engine
 * rounding (`GoldenCheck` amounts are asserted with `toBeCloseTo(amount, 2)`).
 */
import type { MonthIndex, SsInputs, SsPerson } from './types';

export type GoldenCheck =
  | {
      personIndex: 0 | 1;
      month: MonthIndex;
      component: 'own' | 'spousal' | 'survivor' | 'household';
      amount: number;
    } // asserted toBeCloseTo(amount, 2)
  | { total: number }; // lifetime total, evaluateScenario

export interface GoldenFixture {
  inputs: SsInputs;
  expected: { checks: GoldenCheck[] };
  note?: string;
}

export type GoldenKey =
  | 'G1'
  | 'G3'
  | 'G4'
  | 'G5'
  | 'G6'
  | 'G9'
  | 'G10'
  | 'G11a'
  | 'G11b'
  | 'E28a'
  | 'E28b'
  | 'E28c'
  | 'E29'
  | 'E33a'
  | 'E33b'
  | 'E33c'
  | 'E33d'
  | 'E33e'
  | 'E40'
  | 'E41';

/** Calendar month index, `year*12 + (month-1)`. */
const m = (year: number, month: number): MonthIndex => year * 12 + (month - 1);

const AS_OF = { year: 2026, month: 9 } as const;

const pia = (birthYear: number, birthMonth: number, amount: number): SsPerson => ({
  birthYear,
  birthMonth,
  benefit: { kind: 'pia', pia: amount },
});

const collecting = (birthYear: number, birthMonth: number, check: number, sinceMonth: MonthIndex): SsPerson => ({
  birthYear,
  birthMonth,
  benefit: { kind: 'collecting', check, sinceMonth },
});

/** Early-claim husband for G4/G10: PIA 2,800 claimed at 62y1m (70.4167%), born June 1960, since July 2022. */
const HUSBAND_EARLY = collecting(1960, 6, (2800 * 845) / 1200, m(2022, 7));

/** E28 14-month forward series from Sep 2026: four months at `first`, ten at `second` (Jan 2027 COLA step). */
function forwardSeries(first: number, second: number): GoldenCheck[] {
  const checks: GoldenCheck[] = [];
  for (let i = 0; i < 14; i++) {
    checks.push({ personIndex: 0, month: m(2026, 9) + i, component: 'own', amount: i < 4 ? first : second });
  }
  return checks;
}

/** E33: single born June 1970, PIA 2,000, death age 85.0 (June 2055), COLA 0, growth off. */
function e33(claimMonth: MonthIndex, total: number): GoldenFixture {
  return {
    inputs: {
      asOf: AS_OF,
      colaRate: 0,
      growthRate: null,
      people: [pia(1970, 6, 2000)],
      claimMonth: [claimMonth],
      deathAgeYears: [85],
      endYear: 2055,
    },
    expected: { checks: [{ total }] },
  };
}

export const GOLDEN_FIXTURES: Record<GoldenKey, GoldenFixture> = {
  // G1 (ERD §7; FIN-163 R4): PIA 2,300, born June 1970, FRA 67y0m, claim July 2032 (62y1m), COLA 0.
  G1: {
    inputs: {
      asOf: AS_OF,
      colaRate: 0,
      growthRate: null,
      people: [pia(1970, 6, 2300)],
      claimMonth: [m(2032, 7)],
      endYear: 2040,
    },
    expected: { checks: [{ personIndex: 0, month: m(2032, 7), component: 'own', amount: (2300 * 845) / 1200 }] },
    note: '2,300 x 0.704167 = 1,619.5833; engine does no rounding (1,619.58 is the 2-dp assertion).',
  },

  // G3 (ERD §4/§7, video): Sally PIA 1,200 born June 1969 claims July 2031 (62y1m); Jeff PIA 3,500 born
  // June 1965 files at FRA June 2032. Spousal start June 2032 = 48 months before Sally's FRA (June 2036):
  // 25% + 5% = 30% reduction. COLA 1.5%, six January steps (2027..2032).
  G3: {
    inputs: {
      asOf: AS_OF,
      colaRate: 0.015,
      growthRate: null,
      people: [pia(1969, 6, 1200), pia(1965, 6, 3500)],
      claimMonth: [m(2031, 7), m(2032, 6)],
      endYear: 2040,
    },
    expected: { checks: [{ personIndex: 0, month: m(2032, 6), component: 'spousal', amount: 550 * 0.7 * 1.015 ** 6 }] },
    note: 'Engineer-chosen birth/claim pairing ("4 years apart" is an inference; OPEN for ERD-owner confirmation). 393 is the own-filing-basis alternate and is NOT correct.',
  },

  // G4 (ERD §7/§12.4; PRD E29 RIB-LIM): PIAs 2,800 (husband) / 1,000 (wife). Husband collecting since
  // July 2022 (62y1m, own 1,971.67), dies May 2027 (66y11m). Wife born June 1962: 64y11m at the death
  // month, 25 months before survivor FRA 67 (8.4821% off). ageReduced 2,562.50, cap 2,310 binds.
  G4: {
    inputs: {
      asOf: AS_OF,
      colaRate: 0,
      growthRate: null,
      people: [HUSBAND_EARLY, pia(1962, 6, 1000)],
      claimMonth: [null, m(2029, 6)],
      deathAgeYears: [803 / 12, null],
      endYear: 2030,
    },
    expected: {
      checks: [
        { personIndex: 1, month: m(2027, 5), component: 'survivor', amount: 2310 },
        { personIndex: 1, month: m(2027, 5), component: 'household', amount: 2310 },
      ],
    },
  },

  // G5 (ERD §7; PRD E29): died unclaimed before FRA. Husband (PIA 2,800) born Dec 1960 dies Dec 2026 at
  // 66y0m, planned claim Dec 2030 never happens. Wife born Jan 1962: 64y11m at the Dec 2026 start,
  // 25 months before survivor FRA (Jan 2029). 2,800 x 0.915179 = 2,562.50.
  G5: {
    inputs: {
      asOf: AS_OF,
      colaRate: 0,
      growthRate: null,
      people: [pia(1960, 12, 2800), pia(1962, 1, 1000)],
      claimMonth: [m(2030, 12), m(2029, 1)],
      deathAgeYears: [66, null],
      endYear: 2030,
    },
    expected: {
      checks: [
        { personIndex: 1, month: m(2026, 12), component: 'survivor', amount: 2562.5 },
        { personIndex: 1, month: m(2026, 12), component: 'household', amount: 2562.5 },
      ],
    },
  },

  // G6 (ERD §7; PRD E29/E42): died unclaimed after FRA. Husband born Dec 1960 dies Dec 2028 at 68y0m
  // (12 credit months = 8%, base 3,024). Wife born Jan 1962 is 66y11m at the Dec 2028 start, one month
  // before survivor FRA: 3,024 x 0.996607 = 3,013.74.
  G6: {
    inputs: {
      asOf: AS_OF,
      colaRate: 0,
      growthRate: null,
      people: [pia(1960, 12, 2800), pia(1962, 1, 1000)],
      claimMonth: [m(2030, 12), m(2029, 1)],
      deathAgeYears: [68, null],
      endYear: 2031,
    },
    expected: {
      checks: [
        { personIndex: 1, month: m(2028, 12), component: 'survivor', amount: 3024 * (1 - (0.285 * 1) / 84) },
        { personIndex: 1, month: m(2028, 12), component: 'household', amount: 3024 * (1 - (0.285 * 1) / 84) },
      ],
    },
  },

  // G9 (ERD §12.4): after-FRA claim, cap not applicable. PIAs 2,800 / 1,000. Husband born June 1960
  // claims 68y0m (June 2028; 108% = base 3,024), dies Oct 2028. Wife born Nov 1963 is 64y11m at the
  // death month (25 months before survivor FRA 67): 3,024 x 0.9151786 = 2,767.50; cap = null.
  G9: {
    inputs: {
      asOf: AS_OF,
      colaRate: 0,
      growthRate: null,
      people: [pia(1960, 6, 2800), pia(1963, 11, 1000)],
      claimMonth: [m(2028, 6), m(2030, 11)],
      deathAgeYears: [820 / 12, null],
      endYear: 2032,
    },
    expected: {
      checks: [
        { personIndex: 1, month: m(2028, 10), component: 'survivor', amount: 3024 * (1 - (0.285 * 25) / 84) },
        { personIndex: 1, month: m(2028, 10), component: 'household', amount: 3024 * (1 - (0.285 * 25) / 84) },
      ],
    },
    note: 'Engineer-chosen birth/death pairing (ERD fixes only PIAs, 68y0m claim and wife 64y11m at death).',
  },

  // G10 (ERD §12.4): early claim, cap does NOT bind. Husband collecting since July 2022 (RIB 1,971.67,
  // cap = max(1,971.67, 2,310) = 2,310), dies May 2027. Wife born April 1967 is 60y1m at death (survivor
  // FRA 67): 2,800 x 0.718393 = 2,011.50 < 2,310.
  G10: {
    inputs: {
      asOf: AS_OF,
      colaRate: 0,
      growthRate: null,
      people: [HUSBAND_EARLY, pia(1967, 4, 1000)],
      claimMonth: [null, m(2034, 4)],
      deathAgeYears: [803 / 12, null],
      endYear: 2035,
    },
    expected: {
      checks: [
        { personIndex: 1, month: m(2027, 5), component: 'survivor', amount: 2800 * (1 - (0.285 * 83) / 84) },
        { personIndex: 1, month: m(2027, 5), component: 'household', amount: 2800 * (1 - (0.285 * 83) / 84) },
      ],
    },
    note: 'Engineer-chosen wife birth (April 1967) so that she is 60y1m in the death month.',
  },

  // G11a (ERD §12.19.1): collecting, check 2,000, since March of asOf.year-1, asOf JUNE of asOf.year.
  // Year-0 annual = 24,000 (12 x 2,000); series[0][0].own = 2,000 (January). Born Feb 1963 (62y1m = Mar 2025).
  G11a: {
    inputs: {
      asOf: { year: 2026, month: 6 },
      colaRate: 0,
      growthRate: null,
      people: [collecting(1963, 2, 2000, m(2025, 3))],
      claimMonth: [null],
      endYear: 2026,
    },
    expected: {
      checks: [
        { personIndex: 0, month: m(2026, 1), component: 'own', amount: 2000 },
        { personIndex: 0, month: m(2026, 12), component: 'own', amount: 2000 },
      ],
    },
    note: 'Plan annual for year 0 = 24,000 (12 months). Spec fixes asOf in June (the shared 2026-09 convention does not apply).',
  },

  // G11b (ERD §12.19.1): same person shape with sinceMonth April of asOf.year -> year-0 annual 9 x 2,000
  // = 18,000. Born March 1964 (62y1m = Apr 2026).
  G11b: {
    inputs: {
      asOf: { year: 2026, month: 6 },
      colaRate: 0,
      growthRate: null,
      people: [collecting(1964, 3, 2000, m(2026, 4))],
      claimMonth: [null],
      endYear: 2026,
    },
    expected: {
      checks: [
        { personIndex: 0, month: m(2026, 1), component: 'own', amount: 0 },
        { personIndex: 0, month: m(2026, 3), component: 'own', amount: 0 },
        { personIndex: 0, month: m(2026, 4), component: 'own', amount: 2000 },
        { personIndex: 0, month: m(2026, 12), component: 'own', amount: 2000 },
      ],
    },
    note: 'Plan annual for year 0 = 18,000 (9 months). Spec fixes asOf in June.',
  },

  // E28 (PRD E28): already-collecting forward series, asOf 2026-09, COLA 2.5%, first 14 months Sep 2026-Oct 2027.
  // (1) Below FRA: born March 1960, started April 2022 (62y1m), check 2,112.50 (PIA 3,000).
  E28a: {
    inputs: {
      asOf: AS_OF,
      colaRate: 0.025,
      growthRate: null,
      people: [collecting(1960, 3, 2112.5, m(2022, 4))],
      claimMonth: [null],
      endYear: 2027,
    },
    expected: { checks: forwardSeries(2112.5, 2165.3125) },
  },
  // (2) Past FRA, started in an earlier year: born March 1957, started March 2025 (68y0m), PIA 2,000, check 2,240.
  E28b: {
    inputs: {
      asOf: AS_OF,
      colaRate: 0.025,
      growthRate: null,
      people: [collecting(1957, 3, 2240, m(2025, 3))],
      claimMonth: [null],
      endYear: 2027,
    },
    expected: { checks: forwardSeries(2240, 2296) },
  },
  // (3) Past FRA, started in the asOf year: born March 1957, started March 2026, PIA 2,000, check 2,360
  // (118% now, 120% from Jan 2027).
  E28c: {
    inputs: {
      asOf: AS_OF,
      colaRate: 0.025,
      growthRate: null,
      people: [collecting(1957, 3, 2360, m(2026, 3))],
      claimMonth: [null],
      endYear: 2027,
    },
    expected: { checks: forwardSeries(2360, 2460) },
  },

  // E29 (PRD E29): deceased claimed at 70y0m, no cap. Husband (PIA 2,800) born June 1960 claims June 2030
  // (124% = 3,472), dies June 2032 (72y0m). Wife (PIA 1,000) born June 1962 is 70y0m at the survivor start.
  E29: {
    inputs: {
      asOf: AS_OF,
      colaRate: 0,
      growthRate: null,
      people: [pia(1960, 6, 2800), pia(1962, 6, 1000)],
      claimMonth: [m(2030, 6), m(2029, 6)],
      deathAgeYears: [72, null],
      endYear: 2035,
    },
    expected: {
      checks: [
        { personIndex: 1, month: m(2032, 6), component: 'survivor', amount: 3472 },
        { personIndex: 1, month: m(2032, 6), component: 'household', amount: 3472 },
      ],
    },
  },

  // E33a-e (PRD E33, Round 3 live values): single born June 1970, PIA 2,000, death age 85.0 (June 2055,
  // last paid May 2055), COLA 0, growth off.
  E33a: e33(m(2032, 7), 387291.67),
  E33b: e33(m(2040, 6), 446400),
  E33c: e33(m(2037, 6), 432000),
  E33d: e33(m(2038, 6), 440080),
  E33e: e33(m(2040, 5), 445933.33),

  // E40 (PRD E40): survivor base after FRA and before 70. PIA 2,800, husband born June 1970 claims June
  // 2038 (68y0m; 12 credit months = 8%; base 3,024), dies Oct 2038 (68y4m). Wife (PIA 1,000) born June
  // 1971 is 67y4m (past survivor FRA); floor not binding: survivor 3,024.00.
  E40: {
    inputs: {
      asOf: AS_OF,
      colaRate: 0,
      growthRate: null,
      people: [pia(1970, 6, 2800), pia(1971, 6, 1000)],
      claimMonth: [m(2038, 6), m(2038, 6)],
      deathAgeYears: [820 / 12, null],
      endYear: 2042,
    },
    expected: {
      checks: [
        { personIndex: 1, month: m(2038, 10), component: 'survivor', amount: 3024 },
        { personIndex: 1, month: m(2038, 10), component: 'household', amount: 3024 },
      ],
    },
  },

  // E41 (PRD E41): survivor under 60. Husband (PIA 2,800) born Dec 1960 dies Nov 2027 unclaimed (66y11m).
  // Wife born March 1968 (60th birthday March 2028): survivor starts April 2028 (60y1m) = 2,800 x
  // (1 - 0.285 x 83/84) = 2,011.50; household is 0 from Nov 2027 through March 2028.
  E41: {
    inputs: {
      asOf: AS_OF,
      colaRate: 0,
      growthRate: null,
      people: [pia(1960, 12, 2800), pia(1968, 3, 1000)],
      claimMonth: [m(2030, 12), m(2035, 3)],
      deathAgeYears: [803 / 12, null],
      endYear: 2036,
    },
    expected: {
      checks: [
        { personIndex: 1, month: m(2027, 11), component: 'household', amount: 0 },
        { personIndex: 1, month: m(2028, 3), component: 'household', amount: 0 },
        { personIndex: 1, month: m(2028, 4), component: 'survivor', amount: 2800 * (1 - (0.285 * 83) / 84) },
        { personIndex: 1, month: m(2028, 4), component: 'household', amount: 2800 * (1 - (0.285 * 83) / 84) },
      ],
    },
  },
};

/**
 * G7 (ERD §7, PRD E12): growthBalance stream, not an `SsInputs` fixture (owner FIN-167 cites it).
 * $1,000 x 12 at 4.5%: 1,000 x (g^12 - 1)/(g - 1) with g = 1.045^(1/12) = 12,245.5331. The ERD/PRD
 * prose says "about 12,245.50"; the exact recursion is 12,245.53, which is what is pinned here.
 */
export const GOLDEN_G7: { monthly: readonly number[]; growthRate: number; expected: number } = {
  monthly: Array.from({ length: 12 }, () => 1000),
  growthRate: 0.045,
  expected: 12245.53,
};
