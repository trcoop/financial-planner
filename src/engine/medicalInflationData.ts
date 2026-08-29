/**
 * US medical-care CPI-U annual inflation, 1928-2025, mirroring {@link HISTORICAL_ANNUAL_INFLATION}'s
 * shape and sourcing discipline (`inflationData.ts`).
 *
 * Source, 1936-2025 (real BLS data): the medical-care component of CPI-U, U.S. city average, not
 * seasonally adjusted (BLS series CUUR0000SAM), annual-average index levels as compiled by
 * in2013dollars.com (https://www.in2013dollars.com/Medical-care/price-inflation), itself sourced
 * from BLS. This is the same "index level, not someone else's already-computed rate" approach
 * `inflationData.ts` takes against the Minneapolis Fed table. Rate for year Y is computed as
 * `index[Y] / index[Y-1] - 1`.
 *
 * Cross-checked, not taken on faith: the 2022-2025 annual-average index values independently
 * surfaced from FRED-reported figures (546.551 / 549.085 / 563.852 / 580.098) match the
 * in2013dollars series (546.553 / 549.084 / 563.841 / 580.498) to within rounding. Dec-to-Dec
 * spot checks against usinflationcalculator.com's year-end rates (1980: 9.9%, 1990: 9.6%,
 * 2000: 4.2%, 2010: 3.3%) track this table's annual-average rates for the same years (10.95%,
 * 9.08%, 4.06%, 3.41%) the same way `inflationData.ts` documents its own ProjectionLab
 * Dec-vs-annual-average convention difference — not an error, a convention gap.
 *
 * IMPORTANT DEVIATION FROM THE ERD: BLS's medical-care CPI-U component begins in March 1935
 * (confirmed independently — there is no 1934 observation for this series, unlike the
 * all-items CPI-U `inflationData.ts` draws on, which goes back to 1913). That means the first
 * YEAR-OVER-YEAR RATE this series can compute is 1936 (`index[1936] / index[1935] - 1`), not
 * 1935 as the ERD's illustrative range assumed. Real, BLS-sourced rates therefore cover
 * 1936-2025 (90 years), not 1935-2025 — 1935 itself is backfilled along with 1928-1934, giving
 * an 8-year (not 7-year) backfilled range. This is a real finding from the sourcing pass, not a
 * copy-paste range choice; flagged here and in the FIN-72 completion comment since it's exactly
 * the kind of thing a downstream reader would otherwise assume matches the ERD's illustrative
 * text.
 *
 * Backfill, 1928-1935: `medicalInflation[Y] = generalInflation[Y] * RATIO`, where `RATIO` is the
 * average of `medicalInflation[Y] / generalInflation[Y]` computed per-year across the full
 * 1936-2025 overlap against {@link HISTORICAL_ANNUAL_INFLATION} (90 data points, none excluded
 * — no overlap year has a zero general-CPI rate that would make the per-year ratio undefined).
 * That computation gives RATIO = 1.5173, landing inside the ERD §11 Q3's "~1.5-1.6x" illustrative
 * range — a coincidence worth noting (the real number happens to confirm the ballpark secondary
 * citation), not a substitute for having actually computed it from BLS's own series. An
 * unweighted mean of the annual medical rate over the same window is 4.63% (vs. 3.62% general),
 * for reference against the deterministic-branch growthRate `medicareEvent.ts`'s
 * `medicarePartBEvent` computes as this plan's inflation rate plus the ~1.01pp spread FIN-77
 * derives from this same 1936-2025 overlap (not this file's number — noted here only because
 * it is the natural cross-check for this dataset's overall level).
 *
 * Two traps when checking this table, both directly inherited from `inflationData.ts`'s header
 * (same two traps, same fixes, restated here rather than merely cross-referenced since a reader
 * of this file alone should not have to open the other one to know how it was validated):
 *
 * 1. Verifying a SINGLE year against published one-to-three-decimal index levels does not work:
 *    small published rounding on each of two adjacent index levels can carry noticeably more
 *    error than the disagreements such a check is trying to resolve, especially in the
 *    lower-precision pre-1980s figures. Reconstructing the level and comparing THAT against a
 *    published checkpoint is well conditioned; comparing one single-year ratio is not.
 * 2. Compounding all 90 real rates (1936-2025) and checking only the endpoint proves less than
 *    it appears. Each rate is `index[Y]/index[Y-1] - 1`, so the product telescopes exactly to
 *    `index[2025]/index[1935]`: it validates the two endpoints and is blind to every interior
 *    value, and offsetting per-year errors cancel out of it entirely.
 *
 * What the series is actually validated against is the decade-checkpoint reconstruction in
 * `medicalInflationData.test.ts`: the price level rebuilt year by year from the 1935 base index
 * of 10.200 lands within the same tight tolerance as `inflationData.ts`'s checkpoints at 1950,
 * 1960, ... 2020 and 2025 against the source index values quoted above. A corrupted interior year
 * throws off every checkpoint after it, exactly as it does for `inflationData.ts`.
 *
 * 98 years, 1928-2025 inclusive, matching {@link HISTORICAL_ANNUAL_INFLATION}'s and
 * {@link HISTORICAL_ANNUAL_RETURNS}'s range so a Monte Carlo trial's drawn historical year always
 * has both a general-CPI and a medical-CPI entry available. Static and bundled — no network
 * fetch at runtime (this project takes zero network calls after page load, per `CLAUDE.md`).
 */
export interface HistoricalYearMedicalInflation {
  year: number;
  /** Annual medical-care CPI-U change, as a decimal (0.0461 = 4.61%). */
  medicalInflation: number;
}

export const HISTORICAL_ANNUAL_MEDICAL_INFLATION: readonly HistoricalYearMedicalInflation[] = [
  // 1928-1935: backfilled, RATIO = 1.5173 applied to HISTORICAL_ANNUAL_INFLATION's rate for the
  // same year (see header). Not real BLS medical-CPI observations — the series doesn't exist yet.
  { year: 1928, medicalInflation: -0.0174 },
  { year: 1929, medicalInflation: 0.0000 },
  { year: 1930, medicalInflation: -0.0442 },
  { year: 1931, medicalInflation: -0.1362 },
  { year: 1932, medicalInflation: -0.1598 },
  { year: 1933, medicalInflation: -0.0781 },
  { year: 1934, medicalInflation: 0.0589 },
  { year: 1935, medicalInflation: 0.0340 },
  // 1936-2025: real, sourced from BLS medical-care CPI-U component index levels (see header).
  { year: 1936, medicalInflation: 0.0000 },
  { year: 1937, medicalInflation: 0.0081 },
  { year: 1938, medicalInflation: 0.0017 },
  { year: 1939, medicalInflation: 0.0056 },
  { year: 1940, medicalInflation: -0.0008 },
  { year: 1941, medicalInflation: 0.0056 },
  { year: 1942, medicalInflation: 0.0264 },
  { year: 1943, medicalInflation: 0.0476 },
  { year: 1944, medicalInflation: 0.0298 },
  { year: 1945, medicalInflation: 0.0282 },
  { year: 1946, medicalInflation: 0.0471 },
  { year: 1947, medicalInflation: 0.0914 },
  { year: 1948, medicalInflation: 0.0615 },
  { year: 1949, medicalInflation: 0.0325 },
  { year: 1950, medicalInflation: 0.0185 },
  { year: 1951, medicalInflation: 0.0474 },
  { year: 1952, medicalInflation: 0.0548 },
  { year: 1953, medicalInflation: 0.0354 },
  { year: 1954, medicalInflation: 0.0308 },
  { year: 1955, medicalInflation: 0.0234 },
  { year: 1956, medicalInflation: 0.0365 },
  { year: 1957, medicalInflation: 0.0410 },
  { year: 1958, medicalInflation: 0.0479 },
  { year: 1959, medicalInflation: 0.0420 },
  { year: 1960, medicalInflation: 0.0353 },
  { year: 1961, medicalInflation: 0.0303 },
  { year: 1962, medicalInflation: 0.0265 },
  { year: 1963, medicalInflation: 0.0238 },
  { year: 1964, medicalInflation: 0.0204 },
  { year: 1965, medicalInflation: 0.0244 },
  { year: 1966, medicalInflation: 0.0444 },
  { year: 1967, medicalInflation: 0.0703 },
  { year: 1968, medicalInflation: 0.0607 },
  { year: 1969, medicalInflation: 0.0692 },
  { year: 1970, medicalInflation: 0.0634 },
  { year: 1971, medicalInflation: 0.0648 },
  { year: 1972, medicalInflation: 0.0323 },
  { year: 1973, medicalInflation: 0.0386 },
  { year: 1974, medicalInflation: 0.0931 },
  { year: 1975, medicalInflation: 0.1206 },
  { year: 1976, medicalInflation: 0.0951 },
  { year: 1977, medicalInflation: 0.0955 },
  { year: 1978, medicalInflation: 0.0844 },
  { year: 1979, medicalInflation: 0.0925 },
  { year: 1980, medicalInflation: 0.1095 },
  { year: 1981, medicalInflation: 0.1075 },
  { year: 1982, medicalInflation: 0.1161 },
  { year: 1983, medicalInflation: 0.0869 },
  { year: 1984, medicalInflation: 0.0623 },
  { year: 1985, medicalInflation: 0.0623 },
  { year: 1986, medicalInflation: 0.0751 },
  { year: 1987, medicalInflation: 0.0664 },
  { year: 1988, medicalInflation: 0.0653 },
  { year: 1989, medicalInflation: 0.0765 },
  { year: 1990, medicalInflation: 0.0908 },
  { year: 1991, medicalInflation: 0.0873 },
  { year: 1992, medicalInflation: 0.0737 },
  { year: 1993, medicalInflation: 0.0597 },
  { year: 1994, medicalInflation: 0.0477 },
  { year: 1995, medicalInflation: 0.0448 },
  { year: 1996, medicalInflation: 0.0352 },
  { year: 1997, medicalInflation: 0.0279 },
  { year: 1998, medicalInflation: 0.0322 },
  { year: 1999, medicalInflation: 0.0349 },
  { year: 2000, medicalInflation: 0.0406 },
  { year: 2001, medicalInflation: 0.0461 },
  { year: 2002, medicalInflation: 0.0471 },
  { year: 2003, medicalInflation: 0.0402 },
  { year: 2004, medicalInflation: 0.0440 },
  { year: 2005, medicalInflation: 0.0422 },
  { year: 2006, medicalInflation: 0.0401 },
  { year: 2007, medicalInflation: 0.0442 },
  { year: 2008, medicalInflation: 0.0371 },
  { year: 2009, medicalInflation: 0.0317 },
  { year: 2010, medicalInflation: 0.0341 },
  { year: 2011, medicalInflation: 0.0304 },
  { year: 2012, medicalInflation: 0.0366 },
  { year: 2013, medicalInflation: 0.0246 },
  { year: 2014, medicalInflation: 0.0239 },
  { year: 2015, medicalInflation: 0.0263 },
  { year: 2016, medicalInflation: 0.0379 },
  { year: 2017, medicalInflation: 0.0251 },
  { year: 2018, medicalInflation: 0.0197 },
  { year: 2019, medicalInflation: 0.0283 },
  { year: 2020, medicalInflation: 0.0411 },
  { year: 2021, medicalInflation: 0.0123 },
  { year: 2022, medicalInflation: 0.0405 },
  { year: 2023, medicalInflation: 0.0046 },
  { year: 2024, medicalInflation: 0.0269 },
  { year: 2025, medicalInflation: 0.0295 },
];

// `medicalInflationForYear` and its backing `MEDICAL_INFLATION_BY_YEAR` map live in
// `monteCarlo.ts`, mirroring `inflationForYear`/`INFLATION_BY_YEAR`'s existing placement there
// (FIN-65) rather than here — this file stays a pure data table, exactly like `inflationData.ts`.
