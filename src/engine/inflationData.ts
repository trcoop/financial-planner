/**
 * US CPI-U annual inflation, 1928-2025, derived from annual-average CPI index levels.
 *
 * Source: Federal Reserve Bank of Minneapolis, "Consumer Price Index, 1913-"
 * https://www.minneapolisfed.org/about-us/monetary-policy/inflation-calculator/consumer-price-index-1913-
 * (BLS CPI-U annual averages, 1982-84 = 100).
 *
 * Rate for year Y is computed as index[Y] / index[Y-1] - 1, so 1928 uses the 1927 index.
 *
 * The year range deliberately matches {@link HISTORICAL_ANNUAL_RETURNS} (1928-2025) so the
 * Monte Carlo historical path can take a period's return and its cost-of-living increase from
 * THE SAME historical year (FIN-65). That pairing is the published safe-withdrawal-rate
 * method — Bengen (1994) and the Trinity study both inflate the withdrawal by the realised CPI
 * of the year being simulated — and it is what stops the engine from running nominal returns
 * against a flat, invented inflation assumption.
 *
 * 98 years, 1928-2025 inclusive. Static and bundled — no network fetch at runtime (this
 * project takes zero network calls after page load, per `CLAUDE.md`).
 */
export interface HistoricalYearInflation {
  year: number;
  /** Annual CPI-U change, as a decimal (0.0341 = 3.41%). */
  inflation: number;
}

export const HISTORICAL_ANNUAL_INFLATION: readonly HistoricalYearInflation[] = [
  { year: 1928, inflation: -0.0115 },
  { year: 1929, inflation: 0.0000 },
  { year: 1930, inflation: -0.0291 },
  { year: 1931, inflation: -0.0898 },
  { year: 1932, inflation: -0.1053 },
  { year: 1933, inflation: -0.0515 },
  { year: 1934, inflation: 0.0388 },
  { year: 1935, inflation: 0.0224 },
  { year: 1936, inflation: 0.0146 },
  { year: 1937, inflation: 0.0360 },
  { year: 1938, inflation: -0.0208 },
  { year: 1939, inflation: -0.0142 },
  { year: 1940, inflation: 0.0072 },
  { year: 1941, inflation: 0.0500 },
  { year: 1942, inflation: 0.1088 },
  { year: 1943, inflation: 0.0613 },
  { year: 1944, inflation: 0.0173 },
  { year: 1945, inflation: 0.0227 },
  { year: 1946, inflation: 0.0833 },
  { year: 1947, inflation: 0.1436 },
  { year: 1948, inflation: 0.0762 },
  { year: 1949, inflation: -0.0083 },
  { year: 1950, inflation: 0.0126 },
  { year: 1951, inflation: 0.0788 },
  { year: 1952, inflation: 0.0231 },
  { year: 1953, inflation: 0.0075 },
  { year: 1954, inflation: 0.0037 },
  { year: 1955, inflation: -0.0037 },
  { year: 1956, inflation: 0.0149 },
  { year: 1957, inflation: 0.0331 },
  { year: 1958, inflation: 0.0285 },
  { year: 1959, inflation: 0.0104 },
  { year: 1960, inflation: 0.0137 },
  { year: 1961, inflation: 0.0101 },
  { year: 1962, inflation: 0.0134 },
  { year: 1963, inflation: 0.0099 },
  { year: 1964, inflation: 0.0131 },
  { year: 1965, inflation: 0.0161 },
  { year: 1966, inflation: 0.0317 },
  { year: 1967, inflation: 0.0277 },
  { year: 1968, inflation: 0.0419 },
  { year: 1969, inflation: 0.0546 },
  { year: 1970, inflation: 0.0572 },
  { year: 1971, inflation: 0.0438 },
  { year: 1972, inflation: 0.0321 },
  { year: 1973, inflation: 0.0622 },
  { year: 1974, inflation: 0.1104 },
  { year: 1975, inflation: 0.0913 },
  { year: 1976, inflation: 0.0576 },
  { year: 1977, inflation: 0.0650 },
  { year: 1978, inflation: 0.0759 },
  { year: 1979, inflation: 0.1135 },
  { year: 1980, inflation: 0.1350 },
  { year: 1981, inflation: 0.1032 },
  { year: 1982, inflation: 0.0616 },
  { year: 1983, inflation: 0.0321 },
  { year: 1984, inflation: 0.0432 },
  { year: 1985, inflation: 0.0356 },
  { year: 1986, inflation: 0.0186 },
  { year: 1987, inflation: 0.0365 },
  { year: 1988, inflation: 0.0414 },
  { year: 1989, inflation: 0.0482 },
  { year: 1990, inflation: 0.0540 },
  { year: 1991, inflation: 0.0421 },
  { year: 1992, inflation: 0.0301 },
  { year: 1993, inflation: 0.0299 },
  { year: 1994, inflation: 0.0256 },
  { year: 1995, inflation: 0.0283 },
  { year: 1996, inflation: 0.0295 },
  { year: 1997, inflation: 0.0229 },
  { year: 1998, inflation: 0.0156 },
  { year: 1999, inflation: 0.0221 },
  { year: 2000, inflation: 0.0336 },
  { year: 2001, inflation: 0.0285 },
  { year: 2002, inflation: 0.0158 },
  { year: 2003, inflation: 0.0228 },
  { year: 2004, inflation: 0.0266 },
  { year: 2005, inflation: 0.0339 },
  { year: 2006, inflation: 0.0323 },
  { year: 2007, inflation: 0.0283 },
  { year: 2008, inflation: 0.0386 },
  { year: 2009, inflation: -0.0037 },
  { year: 2010, inflation: 0.0168 },
  { year: 2011, inflation: 0.0312 },
  { year: 2012, inflation: 0.0209 },
  { year: 2013, inflation: 0.0148 },
  { year: 2014, inflation: 0.0159 },
  { year: 2015, inflation: 0.0013 },
  { year: 2016, inflation: 0.0127 },
  { year: 2017, inflation: 0.0212 },
  { year: 2018, inflation: 0.0245 },
  { year: 2019, inflation: 0.0183 },
  { year: 2020, inflation: 0.0121 },
  { year: 2021, inflation: 0.0471 },
  { year: 2022, inflation: 0.0801 },
  { year: 2023, inflation: 0.0410 },
  { year: 2024, inflation: 0.0295 },
  { year: 2025, inflation: 0.0261 },
];
