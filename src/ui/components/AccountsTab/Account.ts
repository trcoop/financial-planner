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
  /** Only the value for the active `contributionMode` is meaningful/stored — switching modes in
   * the UI does not attempt to convert the old value into the new mode's units. */
  contributionValue: number
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
    contributionValue: 0,
    ownerId,
  }
}

/** Given a possibly-persisted `accounts` value (untrusted — could be missing/malformed, or from
 * a pre-FIN-117 record with no `accounts` field at all), returns a valid `Account[]` to use.
 * Unlike `Person`'s `seedPeople`, there's no default account to seed — an empty list is always
 * the correct fallback (the Accounts tab's own empty state handles prompting the user). */
export function seedAccounts(accounts: unknown): Account[] {
  if (Array.isArray(accounts)) {
    return accounts as Account[]
  }
  return []
}

/** Whether any account is currently owned by `ownerId` — the real check backing
 * `Person.ts`'s `spouseHasAccounts` retrofit (FIN-117 PM/Eng addendum round 2). Takes a plain
 * `{ ownerId: string }[]` rather than `Account[]` so `Person.ts` doesn't need to import this
 * module just for the type. */
export function hasAccountsForOwner(accounts: Array<{ ownerId: string }>, ownerId: string): boolean {
  return accounts.some((account) => account.ownerId === ownerId)
}
