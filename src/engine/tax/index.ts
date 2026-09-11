/**
 * `src/engine/tax/`'s own barrel (ERD §3). NOT the engine's public surface — that is
 * `src/engine/index.ts`, which re-exports a deliberately narrower subset (no `storyFixtures.ts`;
 * see that module's doc comment).
 */

export { InvalidProjectionInputError } from '../errors';
export type { ProjectionErrorCode } from '../errors';

export { occupyLadder, bandRateAt, ladderTax } from './brackets';
export { computeDeductions, magiForV1, seniorBonusAppliesInYear } from './deductions';
export { computeFica } from './fica';
export { resolveIndexedAmount, resolveIndexedLadder } from './indexing';
export { allocateRounding, roundHalfUp, roundToNearest, truncateTo } from './rounding';
export {
  assertFilingStatusSupported,
  FIRST_SUPPORTED_YEAR,
  resolveTables,
  TAX_TABLES,
  UNSUPPORTED_FILING_STATUSES,
} from './tables';
export { validateFederalTaxInput } from './validation';
export { assertPreferentialLadderAvailable, computeFederalTax } from './federalTax';
export { STORY_FIXTURES, STORY_INDEXING } from './storyFixtures';
export type { StoryScenarioName } from './storyFixtures';

export type {
  BracketOccupancy,
  Confidence,
  DeductionBreakdown,
  FederalTaxInput,
  FederalTaxResult,
  FicaBreakdown,
  FicaParameters,
  FilingStatus,
  IndexedAmount,
  IndexedLadder,
  IndexingPolicy,
  IndexingRates,
  Ladder,
  LadderBand,
  ResolvedYearTables,
  RoundingRule,
  SeniorBonusParameters,
  TaxPayer,
} from './types';
