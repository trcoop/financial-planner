import type { CoreInputValues } from '../CoreInputsForm/CoreInputsForm'
import { rangeError } from '../CoreInputsForm/validation'

/**
 * FIN-116: replaces the FIN-113 `hasSpouse`/`spouseAge` checkbox pair on `CoreInputValues` —
 * spouse is now a full Person entry rather than a boolean + age field. No contribution field
 * here per the PRD ("People tab no longer shows a contribution field") — that lands on Account
 * (FIN-117).
 */
export interface Person {
  id: string
  name: string
  age: number
  retirementAge: number
  salary: number
  isPrimary: boolean
}

export const PERSON_ID_PRIMARY = 'primary'

/** New-Person defaults for a freshly-added spouse — there's no prior data to seed from, unlike
 * the primary (see {@link createPrimaryPerson}). */
export const NEW_SPOUSE_DEFAULTS: Omit<Person, 'id' | 'isPrimary'> = {
  name: 'Spouse',
  age: 35,
  retirementAge: 65,
  salary: 85_000,
}

export const PERSON_FIELD_RANGES = {
  age: { min: 18, max: 100 },
  retirementAge: { min: 18, max: 100 },
  salary: { min: 0, max: 5_000_000 },
}

export function personFieldError(field: 'age' | 'retirementAge' | 'salary', value: number): string | undefined {
  const range = PERSON_FIELD_RANGES[field]
  return rangeError(value, range.min, range.max)
}

/**
 * Seeds the primary Person on first load. Per the PM/Eng review addendum (2026-09-01): the old
 * `hasSpouse`/`spouseAge` checkbox fields on `CoreInputValues` were never used in the wild, so
 * no spouse is ever seeded from them — only the primary Person is created, and the primary's
 * `age` carries over from the existing `core.currentAge` (not blank) so migrating existing
 * saved state loses no data. `retirementAge`/`salary` seed from the corresponding existing
 * `core` fields (`retirementAge`/`currentAnnualIncome`) since those already exist and have
 * user-entered values, unlike a brand-new spouse which has nothing to seed from.
 */
export function createPrimaryPerson(core: CoreInputValues): Person {
  return {
    id: PERSON_ID_PRIMARY,
    name: 'You',
    age: core.currentAge,
    retirementAge: core.retirementAge,
    salary: core.currentAnnualIncome,
    isPrimary: true,
  }
}

let spouseIdCounter = 0

/** Generates a fresh, stable id for a newly-added spouse. `crypto.randomUUID` is available in
 * every environment this app runs in (browsers this app targets, and jsdom under Vitest); the
 * counter fallback only guards an environment where it's unexpectedly absent. */
function generatePersonId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  spouseIdCounter += 1
  return `person-${spouseIdCounter}`
}

export function createSpouse(): Person {
  return {
    id: generatePersonId(),
    isPrimary: false,
    ...NEW_SPOUSE_DEFAULTS,
  }
}

/**
 * Given a possibly-persisted `people` value (untrusted — could be missing, malformed, or from a
 * pre-FIN-116 record with no `people` field at all), returns a valid `Person[]` to use: the
 * persisted list as-is when it's a genuinely non-empty array, otherwise a freshly-seeded
 * primary-only list built from `core`. Never seeds a spouse — see {@link createPrimaryPerson}.
 */
export function seedPeople(people: unknown, core: CoreInputValues): Person[] {
  if (Array.isArray(people) && people.length > 0) {
    return people as Person[]
  }
  return [createPrimaryPerson(core)]
}

/** Finds the primary Person in a list, if any. */
export function primaryPerson(people: Person[]): Person | undefined {
  return people.find((person) => person.isPrimary)
}

/**
 * FIN-116 follow-up: the primary Person's `age`/`retirementAge`/`salary` (edited via the People
 * tab) are the source of truth going forward — `CoreInputValues.currentAge`/`retirementAge`/
 * `currentAnnualIncome` still exist on the type (the engine/`useProjectionState` reads them, and
 * `CORE_FIELD_RANGES` still validates them), but they must never drift independently of the
 * primary Person. This computes an "effective" `CoreInputValues` by overriding
 * `currentAge`/`retirementAge`/`currentAnnualIncome` from the primary Person (falling back to
 * `core`'s own values if, somehow, there's no primary yet), leaving every other field untouched.
 * Callers (PlanSection) should use this result everywhere the engine/persisted core needs the
 * canonical age/retirementAge/income, instead of raw `core`.
 */
export function syncCoreWithPrimary(core: CoreInputValues, people: Person[]): CoreInputValues {
  const primary = primaryPerson(people)
  if (!primary) return core
  return {
    ...core,
    currentAge: primary.age,
    retirementAge: primary.retirementAge,
    currentAnnualIncome: primary.salary,
  }
}

/**
 * FIN-117 retrofit (PM/Eng addendum, round 2): the real check backing the delete-spouse
 * cascade-delete warning dialog (`PeopleTab.tsx`) — true when any account in `accounts` is
 * owned by `personId`. Takes a plain `{ ownerId: string }[]` rather than importing
 * `AccountsTab/Account`'s `Account` type, so this module (and the People tab, which has no
 * other reason to know about Accounts) doesn't need a dependency on the Accounts feature
 * beyond this narrow structural shape.
 */
export function spouseHasAccounts(personId: string, accounts: Array<{ ownerId: string }>): boolean {
  return accounts.some((account) => account.ownerId === personId)
}
