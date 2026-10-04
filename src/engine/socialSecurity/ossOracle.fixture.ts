/**
 * FROZEN Open Social Security (OSS) oracle data for FIN-169. Dev-time only: captured by hand from the
 * live calculator on 2026-10-04; nothing here (or in the tests that read it) touches the network.
 *
 * OSS: https://opensocialsecurity.com (Angular app, source github.com/MikePiper/open-social-security,
 * HEAD 88f8e46ac60c36d3510a979024c7cf062895f107 dated 2026-09-29).
 * Settings for every capture: mortality "Assumed age at death" (fixed), discount rate 0 (so the
 * probability-weighted present value is the plain total in real dollars), no children / disability /
 * still-working / future-cut, COLA N/A (OSS is in today's dollars, the engine runs colaRate 0).
 * Birth day 15 (the engine has no birth day).
 *
 * HOW OSS ROUNDS: each annual cell of its "Year-by-Year Benefit Amounts" table is a whole dollar
 * (per column, per year); the headline present value is a whole dollar; monthly amounts are never shown.
 * Deaths are calendar-year granular: assumed death age D means alive all of year birthYear+D, dead after.
 * Engine mapping: deathAgeYears = D + 1 - (birthMonth - 1) / 12  (death month = January of birthYear+D+1).
 * asOf for every engine run is 2026-10 (the capture date).
 *
 * KNOWN, DOCUMENTED DIVERGENCES (see the FIN-169 report; deliberate engine behavior, not bugs):
 *  - E9 January rule: OSS pays the full delayed-retirement credits from the claim month; the engine
 *    posts a delayed (pre-70) claim's credits only through December of the prior year until the next
 *    January. So OSS >= engine, only for claims after FRA and before 70y0m, only in the claim year.
 *  - Spousal basis: when the spouse's own benefit carries delayed credits, OSS deducts that inflated
 *    benefit from half the other PIA; the engine deducts own PIA (PRD E6). Not exercised by exact cells.
 */

export interface OssAnnualRun {
  /** Key: calendar year; value: whole-dollar household total from the OSS table. */
  annualTotals: Record<number, number>;
  /** OSS present value at discount 0 for the strategy shown. */
  ossPv: number;
}

/** Single, born 1970-04-15, PIA $1,000, assumed death age 80 (alive through 2050). */
export const OSS_SINGLE = {
  birthYear: 1970,
  birthMonth: 4,
  pia: 1000,
  ossDeathAge: 80,
  deathAgeYears: 80.75,
  endYear: 2060,
  /** OSS recommended claim 12/2037 (67y8m) PV $165,373. */
  cells: [
    // claim month/year, OSS PV, claim-year annual, steady annual (last paid year 2050)
    { month: 5, year: 2032, ossPv: 157733, firstAnnual: 5633, steadyAnnual: 8450, delayedBeforeSeventy: false },
    { month: 8, year: 2034, ossPv: 161978, firstAnnual: 4111, steadyAnnual: 9867, delayedBeforeSeventy: false },
    { month: 4, year: 2037, ossPv: 165000, firstAnnual: 9000, steadyAnnual: 12000, delayedBeforeSeventy: false },
    { month: 12, year: 2037, ossPv: 165373, firstAnnual: 1053, steadyAnnual: 12640, delayedBeforeSeventy: true },
    { month: 1, year: 2038, ossPv: 165360, firstAnnual: 12720, steadyAnnual: 12720, delayedBeforeSeventy: true },
    { month: 6, year: 2038, ossPv: 165093, firstAnnual: 7653, steadyAnnual: 13120, delayedBeforeSeventy: true },
    { month: 11, year: 2039, ossPv: 161693, firstAnnual: 2413, steadyAnnual: 14480, delayedBeforeSeventy: true },
    { month: 4, year: 2040, ossPv: 159960, firstAnnual: 11160, steadyAnnual: 14880, delayedBeforeSeventy: false },
  ],
  lastPaidYear: 2050,
} as const;

/**
 * Couple X: A born 1966-03-15 PIA 2800 (OSS death age 85 -> 2051 last year), B born 1968-09-15 PIA 900
 * (OSS death age 90 -> 2058 last year). Engine deathAgeYears [85.8333, 90.3333]. Exact-match cells:
 * the engine reproduces OSS to the dollar (no delayed credits are in play before FRA/at 70, and B's
 * spousal start is at/after B's FRA).
 */
export const OSS_COUPLE_X = {
  a: { birthYear: 1966, birthMonth: 3, pia: 2800 },
  b: { birthYear: 1968, birthMonth: 9, pia: 900 },
  deathAgeYears: [85.8333, 90.3333] as [number, number],
  endYear: 2062,
  cells: [
    {
      // A 3/2036 (70y0m), B 3/2035 (66y6m), spousal 3/2036.
      claim: { a: [2036, 3], b: [2035, 3] },
      ossPv: 1222068,
      totals: { 2035: 8700, 2036: 50160, 2037: 58104, 2051: 58104, 2052: 41664, 2058: 41664 },
      // every year 2037..2051 = 58104, 2052..2058 = 41664
      steady: { from: 2037, to: 2051, amount: 58104, survivorFrom: 2052, survivorTo: 2058, survivorAmount: 41664 },
    },
    {
      // A 3/2036, B 3/2034 (65y6m), spousal 3/2036.
      claim: { a: [2036, 3], b: [2034, 3] },
      ossPv: 1219668,
      totals: { 2034: 8100, 2035: 9720, 2036: 49440, 2037: 57384, 2051: 57384, 2052: 41664, 2058: 41664 },
      steady: { from: 2037, to: 2051, amount: 57384, survivorFrom: 2052, survivorTo: 2058, survivorAmount: 41664 },
    },
  ],
} as const;

/**
 * E40 cap case: couple X's people, but A (the high earner) claims at 62y1m (4/2028) and dies first
 * (OSS death age 75 -> last year 2041, engine 75.8333); B claims 9/2035 (= B's FRA). The survivor base is
 * the deceased's PIA, capped at max(PIA x 0.7042, 0.825 x PIA) = $2,310 -> $27,720/yr.
 * OSS PV for this strategy: $902,965.
 */
export const OSS_E40_CAP = {
  deathAgeYears: [75.8333, 90.3333] as [number, number],
  claim: { a: [2028, 4], b: [2035, 9] },
  ossPv: 902965,
  annualTotals: {
    2028: 17745, 2029: 23660, 2030: 23660, 2031: 23660, 2032: 23660, 2033: 23660, 2034: 23660,
    2035: 29260, 2036: 40460, 2037: 40460, 2038: 40460, 2039: 40460, 2040: 40460, 2041: 40460,
    2042: 27720, 2058: 27720,
  } as Record<number, number>,
  survivorAnnualFrom2042: 27720,
} as const;

/**
 * Couple top-3 golden. A born 1966-03-15 PIA 2800, B born 1968-09-15 PIA 1500 (no spousal excess:
 * 0.5 x 2800 = 1400 < 1500), OSS death ages 85 / 90, discount 0. A claim is 3/2036 (70y0m) in all three.
 * Engine top-3 (12-month-distinct, ranked by total); OSS PV for the same cells captured via the OSS
 * "alternative strategy" form. OSS - engine = E9 January-rule delta (B claims after FRA, before 70).
 * OSS's own recommended strategy is B 8/2037 (68y11m) at $1,250,618 - a cell the engine ranks lower
 * only because of the same E9 delta; recorded for the report, not asserted as an engine result.
 */
export const OSS_COUPLE_TOP3 = {
  a: { birthYear: 1966, birthMonth: 3, pia: 2800 },
  b: { birthYear: 1968, birthMonth: 9, pia: 1500 },
  deathAgeYears: [85.8333, 90.3333] as [number, number],
  endYear: 2070,
  ossRecommended: { a: [2036, 3], b: [2037, 8], ossPv: 1250618 },
  top3: [
    { claimMonths: [24434, 24455], total: 1250338, ossPv: 1250458, e9Delta: 120 }, // B 12/2037
    { claimMonths: [24434, 24443], total: 1249858, ossPv: 1249978, e9Delta: 120 }, // B 12/2036
    { claimMonths: [24434, 24431], total: 1246588, ossPv: 1246618, e9Delta: 30 }, // B 12/2035
  ],
} as const;
