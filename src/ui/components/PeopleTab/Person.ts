import type { CoreInputValues } from '../../coreInputs/types'
import { rangeError } from '../../coreInputs/validation'
import type { AsOf } from '../../../engine/age'
import { systemAsOf } from '../../AsOfContext'

/**
 * FIN-116: replaces the FIN-113 `hasSpouse`/`spouseAge` checkbox pair on `CoreInputValues` —
 * spouse is now a full Person entry rather than a boolean + age field. No contribution field
 * here per the PRD ("People tab no longer shows a contribution field") — that lands on Account
 * (FIN-117).
 */
export interface Person {
  id: string
  name: string
  /** FIN-162: birth month (1-12) and year. The source of truth for age going forward. */
  birthMonth?: number
  birthYear?: number
  /** TRANSITIONAL (FIN-162 -> FIN-179 removes it): calendar age `asOf.year - birthYear`, kept
   * stored so the People tab keeps working. {@link normalizePerson} keeps it in sync, and
   * {@link applyPeopleEdit} turns an edit of it into a `birthYear` write. */
  age: number
  retirementAge: number
  salary: number
  isPrimary: boolean
}

/** A Person whose birth fields are guaranteed present (output of {@link normalizePerson}). The
 * fields are optional on `Person` only while FIN-179 is pending (hand-built partials in tests). */
export type NormalizedPerson = Person & { birthMonth: number; birthYear: number }

export const PERSON_ID_PRIMARY = 'primary'

/** New-Person defaults for a freshly-added spouse — there's no prior data to seed from, unlike
 * the primary (see {@link createPrimaryPerson}). */
export const NEW_SPOUSE_DEFAULTS = {
  name: 'Spouse',
  age: 35,
  retirementAge: 65,
  salary: 85_000,
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** Valid birth-year bounds at `asOf` (PRD E2): age 18 through 100 in calendar-year terms. */
export function birthYearRange(asOf: AsOf): { min: number; max: number } {
  return { min: asOf.year - 100, max: asOf.year - 18 }
}

/** Range error for a birth year, or `undefined` when valid. Live-validation copy (UI only). */
export function birthYearError(birthYear: number, asOf: AsOf): string | undefined {
  const { min, max } = birthYearRange(asOf)
  if (!Number.isFinite(birthYear) || birthYear < min || birthYear > max) {
    return `Birth year must be between ${min} and ${max}.`
  }
  return undefined
}

/**
 * Calendar-year age `asOf.year - birthYear` (E26) — what projection axis, spouse offset, Medicare,
 * retirement gates and `TaxPayer.age` use outside Social Security. Transitional: a Person with no
 * usable `birthYear` (a hand-built partial) falls back to its stored `age`, else NaN.
 */
export function personCalendarAge(person: Pick<Person, 'age' | 'birthYear'>, asOf: AsOf): number {
  if (isFiniteNumber(person.birthYear)) return asOf.year - person.birthYear
  return isFiniteNumber(person.age) ? person.age : NaN
}

/**
 * Never throws. Repairs one untrusted persisted/partial Person into a full one (FIN-117 crash
 * history). Birth fields: a finite `birthYear` wins; else legacy `age` migrates via
 * `birthYear = asOf.year - age`; else the new-spouse default age. `birthMonth` defaults to
 * `asOf.month` (reproduces the stored age in any month). `age` is re-derived from `birthYear`, so
 * the result is idempotent. `asOf` is injected — this never reads the clock.
 */
export function normalizePerson(raw: unknown, asOf: AsOf): NormalizedPerson {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const birthYear = isFiniteNumber(r.birthYear)
    ? r.birthYear
    : asOf.year - (isFiniteNumber(r.age) ? r.age : NEW_SPOUSE_DEFAULTS.age)
  const birthMonth =
    isFiniteNumber(r.birthMonth) && Number.isInteger(r.birthMonth) && r.birthMonth >= 1 && r.birthMonth <= 12
      ? r.birthMonth
      : asOf.month
  const isPrimary = r.isPrimary === true
  return {
    id: typeof r.id === 'string' && r.id !== '' ? r.id : isPrimary ? PERSON_ID_PRIMARY : generatePersonId(),
    name: typeof r.name === 'string' ? r.name : isPrimary ? 'You' : NEW_SPOUSE_DEFAULTS.name,
    birthMonth,
    birthYear,
    age: asOf.year - birthYear,
    retirementAge: isFiniteNumber(r.retirementAge) ? r.retirementAge : NEW_SPOUSE_DEFAULTS.retirementAge,
    salary: isFiniteNumber(r.salary) ? r.salary : NEW_SPOUSE_DEFAULTS.salary,
    isPrimary,
  }
}

/** Never throws: an absent/non-array `people` is `[]`; entries are each normalized. */
export function normalizePeople(raw: unknown, asOf: AsOf): NormalizedPerson[] {
  return Array.isArray(raw) ? raw.map((entry) => normalizePerson(entry, asOf)) : []
}

/**
 * TRANSITIONAL adapter (removed by FIN-179): the People tab still edits `age`. When a person's
 * `age` changed between `prev` and `next`, write `birthYear = asOf.year - age` (keeping
 * `birthMonth`) so the "birthYear wins" rule doesn't revert the edit. A non-finite (blank)
 * age is left as typed, with `birthYear` untouched.
 */
export function applyPeopleEdit(prev: Person[], next: Person[], asOf: AsOf): Person[] {
  return next.map((person) => {
    const before = prev.find((p) => p.id === person.id)
    if (!before || Object.is(before.age, person.age) || !Number.isFinite(person.age)) return person
    return { ...person, birthYear: asOf.year - person.age }
  })
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
export function createPrimaryPerson(core: CoreInputValues, asOf: AsOf = systemAsOf()): Person {
  return {
    id: PERSON_ID_PRIMARY,
    name: 'You',
    birthMonth: asOf.month,
    birthYear: asOf.year - core.currentAge,
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

export function createSpouse(asOf: AsOf = systemAsOf()): Person {
  return {
    id: generatePersonId(),
    isPrimary: false,
    ...NEW_SPOUSE_DEFAULTS,
    birthMonth: asOf.month,
    birthYear: asOf.year - NEW_SPOUSE_DEFAULTS.age,
  }
}

/**
 * Given a possibly-persisted `people` value (untrusted — could be missing, malformed, or from a
 * pre-FIN-116 record with no `people` field at all), returns a valid `Person[]` to use: the
 * persisted list as-is when it's a genuinely non-empty array, otherwise a freshly-seeded
 * primary-only list built from `core`. Never seeds a spouse — see {@link createPrimaryPerson}.
 */
export function seedPeople(people: unknown, core: CoreInputValues, asOf: AsOf = systemAsOf()): Person[] {
  if (Array.isArray(people) && people.length > 0) {
    const normalized = normalizePeople(people, asOf)
    // Keep the input's identity when nothing needed repair (stable memo/effect deps).
    const unchanged = normalized.every((person, i) => {
      const original = people[i] as Record<string, unknown>
      return (Object.keys(person) as (keyof Person)[]).every((key) => Object.is(person[key], original?.[key]))
    })
    return unchanged ? (people as Person[]) : normalized
  }
  return [createPrimaryPerson(core, asOf)]
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
export function syncCoreWithPrimary(core: CoreInputValues, people: Person[], asOf: AsOf = systemAsOf()): CoreInputValues {
  const primary = primaryPerson(people)
  if (!primary) return core
  return {
    ...core,
    currentAge: personCalendarAge(primary, asOf),
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
