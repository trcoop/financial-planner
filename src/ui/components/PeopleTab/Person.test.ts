import { describe, expect, it } from 'vitest'
import type { CoreInputValues } from '../CoreInputsForm/CoreInputsForm'
import { DEFAULT_CORE_VALUES } from '../CoreInputsForm/defaults'
import {
  createPrimaryPerson,
  createSpouse,
  personFieldError,
  seedPeople,
  spouseHasAccounts,
  PERSON_ID_PRIMARY,
} from './Person'

describe('createPrimaryPerson', () => {
  it('seeds age from core.currentAge (not blank)', () => {
    const core = { ...DEFAULT_CORE_VALUES, currentAge: 47 }
    expect(createPrimaryPerson(core).age).toBe(47)
  })

  it('seeds retirementAge and salary from the corresponding core fields', () => {
    const core = { ...DEFAULT_CORE_VALUES, retirementAge: 62, currentAnnualIncome: 120000 }
    const primary = createPrimaryPerson(core)
    expect(primary.retirementAge).toBe(62)
    expect(primary.salary).toBe(120000)
  })

  it('is marked isPrimary and non-deletable by convention (id === PERSON_ID_PRIMARY)', () => {
    const primary = createPrimaryPerson(DEFAULT_CORE_VALUES)
    expect(primary.isPrimary).toBe(true)
    expect(primary.id).toBe(PERSON_ID_PRIMARY)
  })
})

describe('createSpouse', () => {
  it('creates a non-primary person with sensible new-person defaults', () => {
    const spouse = createSpouse()
    expect(spouse.isPrimary).toBe(false)
    expect(spouse.age).toBeGreaterThan(0)
    expect(spouse.retirementAge).toBeGreaterThan(0)
    expect(spouse.salary).toBeGreaterThanOrEqual(0)
  })

  it('generates a unique id per call', () => {
    const a = createSpouse()
    const b = createSpouse()
    expect(a.id).not.toBe(b.id)
  })
})

describe('seedPeople (migration)', () => {
  it('seeds only a primary person when no people have ever been persisted', () => {
    const core = { ...DEFAULT_CORE_VALUES, currentAge: 40 }
    const people = seedPeople(undefined, core)

    expect(people).toHaveLength(1)
    expect(people[0].isPrimary).toBe(true)
    expect(people[0].age).toBe(40)
  })

  it('does not seed a spouse even given a pre-FIN-116 record with leftover hasSpouse/spouseAge fields', () => {
    // Old FIN-113 shape: hasSpouse/spouseAge used to live on core; those fields are retired from
    // CoreInputValues entirely now, but a persisted pre-migration record on disk could still
    // carry them (as untyped JSON) — seedPeople must never read them to seed a spouse.
    const core = { ...DEFAULT_CORE_VALUES, currentAge: 45 } as CoreInputValues & {
      hasSpouse: boolean
      spouseAge: number
    }
    core.hasSpouse = true
    core.spouseAge = 38
    const people = seedPeople(undefined, core)

    expect(people).toHaveLength(1)
    expect(people[0].isPrimary).toBe(true)
    expect(people[0].age).toBe(45)
    expect(people.some((p) => !p.isPrimary)).toBe(false)
  })

  it('returns an already-persisted non-empty people list unchanged', () => {
    const existing = [createPrimaryPerson(DEFAULT_CORE_VALUES), createSpouse()]
    expect(seedPeople(existing, DEFAULT_CORE_VALUES)).toBe(existing)
  })

  it('re-seeds when the persisted value is not a non-empty array (malformed/empty)', () => {
    expect(seedPeople([], DEFAULT_CORE_VALUES)).toHaveLength(1)
    expect(seedPeople('not-an-array', DEFAULT_CORE_VALUES)).toHaveLength(1)
    expect(seedPeople(null, DEFAULT_CORE_VALUES)).toHaveLength(1)
  })
})

describe('personFieldError', () => {
  it('flags an out-of-range age', () => {
    expect(personFieldError('age', 150)).toMatch(/between 18 and 100/i)
    expect(personFieldError('age', 40)).toBeUndefined()
  })

  it('flags an out-of-range salary', () => {
    expect(personFieldError('salary', -1)).toMatch(/between 0/i)
    expect(personFieldError('salary', 90000)).toBeUndefined()
  })
})

describe('spouseHasAccounts (FIN-117 retrofit)', () => {
  it('returns false when no account has that ownerId', () => {
    expect(spouseHasAccounts('spouse-1', [{ ownerId: 'primary' }])).toBe(false)
  })

  it('returns false against an empty accounts list', () => {
    expect(spouseHasAccounts('spouse-1', [])).toBe(false)
  })

  it('returns true when at least one account is owned by that person id', () => {
    expect(spouseHasAccounts('spouse-1', [{ ownerId: 'primary' }, { ownerId: 'spouse-1' }])).toBe(true)
  })
})
