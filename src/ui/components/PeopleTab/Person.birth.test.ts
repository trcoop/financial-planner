import { describe, expect, it } from 'vitest'
import { DEFAULT_CORE_VALUES } from '../../coreInputs/defaults'
import { calendarAge } from '../../../engine/age'
import { spouseMedicarePartBEvent } from '../../medicareEvent'
import {
  applyPeopleEdit,
  birthMonthFieldError,
  birthYearFieldError,
  createPrimaryPerson,
  createSpouse,
  personBirth,
  personCalendarAge,
  seedPeople,
  syncCoreWithPrimary,
} from './Person'

const ASOF = { year: 2026, month: 9 }

describe('personBirth (consumer fallback, never persisted)', () => {
  it('no birth fields: year = asOf.year - age, month = asOf.month', () => {
    expect(personBirth({ age: 40 }, ASOF)).toEqual({ year: 1986, month: 9 })
  })
  it('valid birth fields are used as-is, even when age disagrees', () => {
    expect(personBirth({ age: 30, birthYear: 1980, birthMonth: 4 }, ASOF)).toEqual({ year: 1980, month: 4 })
  })
  it.each([
    [{ birthYear: 1980 }],
    [{ birthMonth: 4 }],
    [{ birthYear: 1980, birthMonth: 13 }],
    [{ birthYear: 1980, birthMonth: 0 }],
    [{ birthYear: 1980.5, birthMonth: 4 }],
    [{ birthYear: NaN, birthMonth: 4 }],
  ])('a missing/invalid half (%j) falls back to age for both', (birth) => {
    expect(personBirth({ age: 40, ...birth }, ASOF)).toEqual({ year: 1986, month: 9 })
  })
  it('no usable age and no birth: year is NaN, never throws', () => {
    expect(personBirth({ age: NaN }, ASOF).year).toBeNaN()
    expect(() => personBirth({} as never, ASOF)).not.toThrow()
  })
  it('does not mutate the person', () => {
    const p = { age: 40 }
    personBirth(p, ASOF)
    expect(p).toEqual({ age: 40 })
  })
})

describe('seedPeople passes persisted people through untouched (no load-time repair)', () => {
  it('keeps the same array; missing salary/retirementAge/birth stay missing', () => {
    const raw = [{ id: 'primary', name: 'You', age: 17, isPrimary: true }]
    const out = seedPeople(raw, DEFAULT_CORE_VALUES, ASOF)
    expect(out).toBe(raw)
    expect(out[0]).toEqual({ id: 'primary', name: 'You', age: 17, isPrimary: true })
    expect('salary' in out[0]).toBe(false)
    expect('birthYear' in out[0]).toBe(false)
  })
  it('seeds a primary when absent', () => {
    expect(seedPeople(undefined, { ...DEFAULT_CORE_VALUES, currentAge: 40 }, ASOF)[0]).toMatchObject({
      isPrimary: true,
      age: 40,
      birthYear: 1986,
      birthMonth: 9,
    })
  })
})

describe('creators set defaults (new-person creation only)', () => {
  it('createSpouse default is clock-based (35 years old at asOf), salary 85,000', () => {
    const s = createSpouse(ASOF)
    expect(s.birthYear).toBe(1991)
    expect(s.birthMonth).toBe(9)
    expect(s.age).toBe(35)
    expect(s.salary).toBe(85_000)
  })
})

describe('People page birth field validation', () => {
  it('missing birth month / year are flagged as required', () => {
    expect(birthMonthFieldError({})).toBe('Birth month is required.')
    expect(birthYearFieldError({})).toBe('Birth year is required.')
  })
  it('a present value (even out of range or odd) is never flagged: the dropdown cannot produce one', () => {
    expect(birthMonthFieldError({ birthMonth: 4 })).toBeUndefined()
    expect(birthYearFieldError({ birthYear: 1986 })).toBeUndefined()
    expect(birthYearFieldError({ birthYear: 1500 })).toBeUndefined()
  })
})

describe('transitional age adapter', () => {
  it('editing age writes birthYear = asOf.year - age, keeping birthMonth', () => {
    const prev = [{ ...createPrimaryPerson(DEFAULT_CORE_VALUES, ASOF), birthMonth: 3 }]
    const next = applyPeopleEdit(prev, [{ ...prev[0], age: 50 }], ASOF)
    expect(next[0].birthYear).toBe(1976)
    expect(next[0].birthMonth).toBe(3)
  })
  it('an age edit on a person with no birthYear leaves birth absent (age stays the source)', () => {
    const prev = [{ id: 'primary', name: 'You', age: 40, retirementAge: 65, salary: 1, isPrimary: true }]
    const next = applyPeopleEdit(prev, [{ ...prev[0], age: 50 }], ASOF)
    expect('birthYear' in next[0]).toBe(false)
    expect(next[0].age).toBe(50)
  })
  it('a blank (NaN) age edit is left as typed', () => {
    const prev = [createPrimaryPerson(DEFAULT_CORE_VALUES, ASOF)]
    const next = applyPeopleEdit(prev, [{ ...prev[0], age: NaN }], ASOF)
    expect(next[0].age).toBeNaN()
    expect(next[0].birthYear).toBe(prev[0].birthYear)
  })
  it('a salary-only edit leaves birthYear alone even when stored age disagrees', () => {
    const prev = [{ ...createPrimaryPerson(DEFAULT_CORE_VALUES, ASOF), age: 30, birthYear: 1980 }]
    const next = applyPeopleEdit(prev, [{ ...prev[0], salary: 1 }], ASOF)
    expect(next[0].birthYear).toBe(1980)
    expect(next[0].age).toBe(30)
  })
})

describe('calendar age callers (E4)', () => {
  it('personCalendarAge = asOf.year - birthYear regardless of birth month', () => {
    expect(personCalendarAge({ age: 1, birthYear: 1986, birthMonth: 12 }, ASOF)).toBe(40)
    expect(personCalendarAge({ age: 1, birthYear: 1986, birthMonth: 12 }, ASOF)).toBe(calendarAge(1986, ASOF))
  })
  it('falls back to stored age when birth is absent', () => {
    expect(personCalendarAge({ age: 33 }, ASOF)).toBe(33)
  })
  it('spouse Medicare offset uses calendar ages: primary 1986, spouse 1988 -> startAge 67 in any birth month', () => {
    for (const m of [1, 9, 12]) {
      const primary = { age: 0, birthYear: 1986, birthMonth: m }
      const spouse = { age: 0, birthYear: 1988, birthMonth: 13 - m }
      const e = spouseMedicarePartBEvent(personCalendarAge(primary, ASOF), personCalendarAge(spouse, ASOF), 0.03)
      expect(e.startAge).toBe(67)
    }
  })
})

describe('syncCoreWithPrimary', () => {
  it('core.currentAge = asOf.year - birthYear even when stored age disagrees', () => {
    const primary = { ...createPrimaryPerson(DEFAULT_CORE_VALUES, ASOF), age: 30, birthYear: 1980 }
    expect(syncCoreWithPrimary(DEFAULT_CORE_VALUES, [primary], ASOF).currentAge).toBe(46)
  })
  it('a legacy primary (age only) keeps its age; a missing salary passes through as undefined, not an invented value', () => {
    const primary = { id: 'primary', name: 'You', age: 40, retirementAge: 65, isPrimary: true } as never
    const core = syncCoreWithPrimary(DEFAULT_CORE_VALUES, [primary], ASOF)
    expect(core.currentAge).toBe(40)
    expect(core.currentAnnualIncome).not.toBe(85_000)
  })
})
