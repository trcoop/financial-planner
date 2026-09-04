import { rangeError } from '../../coreInputs/validation'

/**
 * FIN-135: UI-owned settings shape for the Retirement Spending tab, persisted alongside
 * `AdvancedAssumptionValues`/`Person`/`Account` in `src/storage/` — mirrors `AdvancedAssumptionValues`'s
 * home in `AdvancedAssumptionsForm/`, a UI-owned settings shape rather than an engine type
 * (`src/ui/` does not import engine internals directly for this — only the standalone
 * `retirementNumber` module, the same way `InvestmentCalculator` imports `investmentCalculator.ts`
 * directly per architecture.md's precedent for sibling, non-pipeline engine modules).
 *
 * ERD §4 (round 2 review correction): a round-trip-safe two-field contract, NOT a
 * monthly-normalized single number — `generalAmount` is the raw value exactly as entered, and
 * `generalAmountUnit` says which unit it's in. An annual entry of $60,000 must redisplay as
 * "$60,000" annual on return to this tab, not a derived $5,000/month figure. The conversion to
 * `PlanAssumptions.retirementSpendingGoal.annualAmount`-ready engine dollars happens only at
 * {@link retirementSpendingGoalAnnualAmount}, the `useProjectionState` wiring boundary — never at
 * this persistence layer.
 */
export interface RetirementSpendingValues {
  /** Raw value as entered by the user, in whichever unit `generalAmountUnit` says — NOT
   * normalized to monthly. This is what round-trips back into the form field unedited.
   * `undefined` (or `0` — see {@link retirementSpendingGoalAnnualAmount}) means no goal set. */
  generalAmount?: number
  /** Which unit `generalAmount` is currently expressed in. Defaults to `'monthly'` when
   * `generalAmount` is set but this is somehow absent (defensive only — the UI always writes
   * both together). */
  generalAmountUnit?: 'monthly' | 'annual'
  /** Primary's suggested-but-editable Medicare Part B first-year amount. `undefined` = use the
   * suggested default (`MEDICARE_PART_B_EVENT.annualAmount`) — absence, not a copied default
   * value, so the suggested figure can move (e.g. next year's CMS update) without a stale
   * persisted plan pinning last year's number forever. Collected here; wiring it into the actual
   * Medicare event call is FIN-136's job (`medicareEvent.ts`'s `annualAmountOverride` param has
   * not landed yet), not this ticket's. */
  primaryMedicareAnnualAmount?: number
  /** Spouse's own line, same terms, only rendered/meaningful when a spouse `Person` exists. */
  spouseMedicareAnnualAmount?: number
}

/** No goal set, no Medicare overrides — the "never opened this tab" / "opted out" default. Every
 * plan that predates this ticket, or that a user has never edited on this tab, resolves here. */
export const DEFAULT_RETIREMENT_SPENDING_VALUES: RetirementSpendingValues = {}

/**
 * Converts a `RetirementSpendingValues`'s raw entered amount into the engine-ready ANNUAL,
 * today's-dollars figure `useProjectionState`'s `retirementSpendingGoalAnnualAmount` param wants
 * (ERD §4's `toAssumptions`-adjacent wiring boundary): `generalAmountUnit === 'annual' ?
 * generalAmount : generalAmount * 12`. `generalAmountUnit` absent (defensive — the UI always
 * writes both together) is treated as `'monthly'`.
 *
 * Returns `undefined` for both an unset `generalAmount` and an explicit `0`, regardless of unit
 * (ERD §9's wiring rule) — a $0 goal has no coherent product meaning worth representing
 * separately from "no goal set" at all, and either value means the plan falls back to today's
 * rate-driven withdrawal behavior unchanged (opt-in, no migration prompt).
 */
export function retirementSpendingGoalAnnualAmount(values: RetirementSpendingValues): number | undefined {
  if (!values.generalAmount) return undefined
  return values.generalAmountUnit === 'annual' ? values.generalAmount : values.generalAmount * 12
}

/** Upper bound chosen so an annual-mode entry (12x a monthly-mode one) has equivalent headroom —
 * a household typing the same real spending goal in either unit should never find one unit's
 * range artificially tighter than the other's. */
const GENERAL_AMOUNT_MAX_MONTHLY = 1_000_000
const GENERAL_AMOUNT_MAX_ANNUAL = GENERAL_AMOUNT_MAX_MONTHLY * 12

/** Range-checks the general spending goal's raw entered value, scaled to whichever unit it's
 * currently in — mirrors `personFieldError`/`accountContributionError`'s per-field range-check
 * pattern (`Person.ts`/`Account.ts`). */
export function generalAmountError(value: number, unit: 'monthly' | 'annual'): string | undefined {
  const max = unit === 'annual' ? GENERAL_AMOUNT_MAX_ANNUAL : GENERAL_AMOUNT_MAX_MONTHLY
  return rangeError(value, 0, max)
}

/** Range for a single person's Medicare Part B annual override — wide enough to cover a
 * meaningfully IRMAA-inflated premium (still out of scope per the PRD, but not worth clamping a
 * user-entered override tightly around today's standard premium). */
const MEDICARE_AMOUNT_MAX = 100_000

/** Range-checks a Medicare annual-amount override (primary or spouse — same range for both, per
 * `medicareEvent.ts`'s existing "no separate cost basis for a spouse's Part B premium" note). */
export function medicareAmountError(value: number): string | undefined {
  return rangeError(value, 0, MEDICARE_AMOUNT_MAX)
}
