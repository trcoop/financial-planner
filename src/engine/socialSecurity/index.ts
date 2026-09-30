/**
 * Public surface of the Social Security engine. Pre-exports every name owned by later work
 * packages so downstream tickets replace stub bodies in their own files and never edit this
 * barrel (ERD §12.25.3).
 */
export {
  ageMonthsAt,
  ageYearsExactAt,
  birthMonthIndex,
  calculatorStartMonth,
  calendarAge,
  firstClaimableMonth,
  monthIndex,
  planCalendarYear,
} from '../age';

export * from './constants';
export type {
  AsOf,
  MonthIndex,
  SsAnnualRow,
  SsAnnualSchedule,
  SsBenefitSource,
  SsErrorCode,
  SsInputs,
  SsMonth,
  SsPerson,
  SsResult,
  SsStartKind,
  SurvivorArgs,
  TopClaim,
  TopClaimsAxis,
} from './types';

export { fraMonths, legalClaimWindow, ownFactorAt, ownFactorSteady, survivorFraMonths } from './benefit';
export { computeOwnAndSpousal, spousalAmount } from './spousal';
export { survivorBreakdown } from './survivor';
export {
  computeSocialSecurity,
  evaluateGrid,
  evaluateScenario,
  findCrossings,
  growthBalance,
  topClaims,
} from './evaluate';
export { buildSsAnnualSchedule } from './schedule';
