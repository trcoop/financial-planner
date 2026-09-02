import type { CoreInputValues } from '../CoreInputsForm/CoreInputsForm'
import { rangeError } from '../CoreInputsForm/validation'

/**
 * FIN-117: Account model per the PRD ("PRD: Profile Settings — People & Accounts") — a Person
 * (`../PeopleTab/Person.ts`) can own zero or more Accounts. No engine/projection wiring here
 * (that's FIN-118) — this ticket is data model + CRUD + persistence only.
 */
export type AccountType = 'taxable' | 'roth' | 'traditional'

export type ContributionMode = 'percentage' | 'fixed'

export interface Account {
  id: string
  name: string
  type: AccountType
  /** Current balance, always "as of today" — no historical/date tracking in v1 per the PRD. */
  balance: number
  contributionMode: ContributionMode
  /** The percentage-mode contribution rate, remembered independently of `contributionFixed` —
   * switching `contributionMode` back and forth must never reinterpret one unit as the other
   * (15% becoming $15, or $15,000 becoming 15,000%). Only the field matching the active
   * `contributionMode` drives the account's actual contribution; the other just holds its own
   * last-set value in case the user switches back. */
  contributionPercentage: number
  /** The fixed-dollar-mode contribution amount — see `contributionPercentage`'s doc comment. */
  contributionFixed: number
  /** id of the owning `Person` (`Person.id`). */
  ownerId: string
}

export const ACCOUNT_TYPE_OPTIONS: Array<{ value: AccountType; label: string }> = [
  { value: 'taxable', label: 'Taxable' },
  { value: 'roth', label: 'Roth' },
  { value: 'traditional', label: 'Traditional' },
]

export const ACCOUNT_FIELD_RANGES = {
  balance: { min: 0, max: 100_000_000 },
  contributionPercentage: { min: 0, max: 100 },
  contributionFixed: { min: 0, max: 5_000_000 },
}

export function accountBalanceError(value: number): string | undefined {
  return rangeError(value, ACCOUNT_FIELD_RANGES.balance.min, ACCOUNT_FIELD_RANGES.balance.max)
}

/** Contribution's valid range depends on which mode is active — percentage is bounded 0-100,
 * a fixed dollar amount has its own (much larger) ceiling. */
export function accountContributionError(mode: ContributionMode, value: number): string | undefined {
  const range = mode === 'percentage' ? ACCOUNT_FIELD_RANGES.contributionPercentage : ACCOUNT_FIELD_RANGES.contributionFixed
  return rangeError(value, range.min, range.max)
}

let accountIdCounter = 0

/** Same `crypto.randomUUID` + counter-fallback pattern as `Person.ts`'s `generatePersonId`. */
function generateAccountId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  accountIdCounter += 1
  return `account-${accountIdCounter}`
}

/** New-Account defaults for the "+ Account" button — `ownerId` is the only thing that can't have
 * a fixed default (must be a real, currently-existing Person), so it's a required argument. */
export function createAccount(ownerId: string): Account {
  return {
    id: generateAccountId(),
    name: 'New account',
    type: 'taxable',
    balance: 0,
    contributionMode: 'percentage',
    contributionPercentage: 0,
    contributionFixed: 0,
    ownerId,
  }
}

/** Builds the default primary-person account seeded from the legacy `CoreInputValues` fields
 * (`initialBalance`/`annualContributionRatePercent`) — used only when migrating a pre-FIN-117
 * record that predates the Account model, so the old single-balance/single-rate mental model
 * carries over as one taxable account rather than silently vanishing. */
export function createDefaultPrimaryAccount(primaryPersonId: string, core: CoreInputValues): Account {
  return {
    id: generateAccountId(),
    name: 'Primary account',
    type: 'taxable',
    balance: core.initialBalance,
    contributionMode: 'percentage',
    contributionPercentage: core.annualContributionRatePercent,
    contributionFixed: 0,
    ownerId: primaryPersonId,
  }
}

/** Given a possibly-persisted `accounts` value (untrusted — could be missing/malformed, or from
 * a pre-FIN-117 record with no `accounts` field at all), returns a valid `Account[]` to use.
 * A record that already has an `accounts` array — even an explicitly empty one, e.g. after the
 * user deletes their only account — is left alone (no re-seeding); only a genuinely missing/
 * malformed field gets the migrated default primary account seeded from the old core values. */
export function seedAccounts(accounts: unknown, primaryPersonId: string, core: CoreInputValues): Account[] {
  if (Array.isArray(accounts)) {
    return accounts as Account[]
  }
  return [createDefaultPrimaryAccount(primaryPersonId, core)]
}

/** The primary person's first owned account, if any — used to derive "effective" core values
 * (see `syncCoreWithPrimaryAccount`) the same way `Person.ts`'s `syncCoreWithPrimary` derives
 * age/retirementAge/salary from the primary Person. */
export function primaryAccountFor(accounts: Account[], primaryPersonId: string): Account | undefined {
  return accounts.find((account) => account.ownerId === primaryPersonId)
}

/** Overrides `core.initialBalance`/`annualContributionRatePercent` with the primary's own
 * account values, mirroring `syncCoreWithPrimary`'s pattern for age/retirementAge/salary. This
 * is deliberately UI-layer plumbing (not engine wiring, that's FIN-118) — it exists only so the
 * now-hidden `CoreInputValues` fields don't go stale relative to the real source of truth (the
 * primary's Account). When there's no primary account (e.g. the user deleted their only
 * account), both fields are zeroed rather than left as whatever `core` happened to be carrying
 * — there is no UI anywhere to edit those hidden fields any more, so leaving them alone would
 * silently resurrect stale frozen data instead of reflecting the real "no account" state. A
 * `fixed` contribution mode has no clean translation to a percentage rate, so in that case the
 * contribution rate is left as-is (an acknowledged limitation properly owned by FIN-118's real
 * engine-aware contribution-mode handling, not this fix). */
export function syncCoreWithPrimaryAccount(core: CoreInputValues, account: Account | undefined): CoreInputValues {
  if (!account) {
    return { ...core, initialBalance: 0, annualContributionRatePercent: 0 }
  }
  return {
    ...core,
    initialBalance: account.balance,
    annualContributionRatePercent:
      account.contributionMode === 'percentage' ? account.contributionPercentage : core.annualContributionRatePercent,
  }
}

/** Whether any account is currently owned by `ownerId` — the real check backing
 * `Person.ts`'s `spouseHasAccounts` retrofit (FIN-117 PM/Eng addendum round 2). Takes a plain
 * `{ ownerId: string }[]` rather than `Account[]` so `Person.ts` doesn't need to import this
 * module just for the type. */
export function hasAccountsForOwner(accounts: Array<{ ownerId: string }>, ownerId: string): boolean {
  return accounts.some((account) => account.ownerId === ownerId)
}
