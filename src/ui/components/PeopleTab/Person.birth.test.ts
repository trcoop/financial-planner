import { describe, expect, it } from 'vitest'
import { DEFAULT_CORE_VALUES } from '../../coreInputs/defaults'
import { calendarAge } from '../../../engine/age'
import { spouseMedicarePartBEvent } from '../../medicareEvent'
import {
  applyPeopleEdit,
  birthYearError,
  createPrimaryPerson,
  createSpouse,
  normalizePerson,
  normalizePeople,
  personCalendarAge,
  seedPeople,
  syncCoreWithPrimary,
} from './Person'

const ASOF = { year: 2026, month: 9 }

describe('normalizePerson', () => {
  it('legacy record: {age:40} at asOf 2026-09 -> birthYear 1986, birthMonth 9; second load identical', () => {
    const first = normalizePerson({ id: 'primary', name: 'You', age: 40, retirementAge: 65, salary: 1, isPrimary: true }, ASOF)
    expect(first.birthYear).toBe(1986)
    expect(first.birthMonth).toBe(9)
    expect(first.age).toBe(40)
    expect(normalizePerson(first, ASOF)).toEqual(first)
  })

  it('never throws on junk input', () => {
    const junk: unknown[] = [null, undefined, NaN, 'x', 5, [], {}, { age: 'abc' }, { age: NaN, birthYear: null, birthMonth: 'z' }, { birthMonth: 99, birthYear: 'q' }]
    for (const j of junk) {
      expect(() => normalizePerson(j, ASOF)).not.toThrow()
      const p = normalizePerson(j, ASOF)
      expect(Number.isFinite(p.birthYear)).toBe(true)
      expect(p.birthMonth).toBeGreaterThanOrEqual(1)
      expect(p.birthMonth).toBeLessThanOrEqual(12)
      expect(Number.isFinite(p.age)).toBe(true)
      expect(normalizePerson(p, ASOF)).toEqual(p)
    }
  })

  it('birthYear wins over a conflicting stored age', () => {
    const p = normalizePerson({ age: 30, birthYear: 1980, birthMonth: 2 }, ASOF)
    expect(p.birthYear).toBe(1980)
    expect(p.birthMonth).toBe(2)
    expect(p.age).toBe(46)
  })
})

describe('normalizePeople / seedPeople', () => {
  it('absent or non-array people normalize to []', () => {
    expect(normalizePeople(undefined, ASOF)).toEqual([])
    expect(normalizePeople('x', ASOF)).toEqual([])
  })
  it('seedPeople seeds a clock-based primary when absent', () => {
    const [p] = seedPeople(undefined, { ...DEFAULT_CORE_VALUES, currentAge: 40 }, ASOF)
    expect(p.birthYear).toBe(1986)
    expect(p.birthMonth).toBe(9)
  })
  it('seedPeople returns the same array when already normalized', () => {
    const existing = [createPrimaryPerson(DEFAULT_CORE_VALUES, ASOF), createSpouse(ASOF)]
    expect(seedPeople(existing, DEFAULT_CORE_VALUES, ASOF)).toBe(existing)
  })
})

describe('creators', () => {
  it('createSpouse default is clock-based (35 years old at asOf)', () => {
    const s = createSpouse(ASOF)
    expect(s.birthYear).toBe(1991)
    expect(s.birthMonth).toBe(9)
    expect(s.age).toBe(35)
  })
})

describe('birthYearError', () => {
  it('uses the spec copy and range', () => {
    expect(birthYearError(1925, ASOF)).toBe('Birth year must be between 1926 and 2008.')
    expect(birthYearError(2009, ASOF)).toBe('Birth year must be between 1926 and 2008.')
    expect(birthYearError(1926, ASOF)).toBeUndefined()
    expect(birthYearError(2008, ASOF)).toBeUndefined()
    expect(birthYearError(NaN, ASOF)).toBe('Birth year must be between 1926 and 2008.')
  })
})

describe('transitional age adapter', () => {
  it('editing age writes birthYear = asOf.year - age, keeping birthMonth, and is not reverted on reload', () => {
    const prev = [{ ...createPrimaryPerson(DEFAULT_CORE_VALUES, ASOF), birthMonth: 3 }]
    const edited = [{ ...prev[0], age: 50 }]
    const next = applyPeopleEdit(prev, edited, ASOF)
    expect(next[0].birthYear).toBe(1976)
    expect(next[0].birthMonth).toBe(3)
    expect(normalizePerson(next[0], ASOF).age).toBe(50)
  })
  it('a blank (NaN) age edit is left as typed', () => {
    const prev = [createPrimaryPerson(DEFAULT_CORE_VALUES, ASOF)]
    const next = applyPeopleEdit(prev, [{ ...prev[0], age: NaN }], ASOF)
    expect(next[0].age).toBeNaN()
    expect(next[0].birthYear).toBe(prev[0].birthYear)
  })
  it('non-age edits pass through untouched', () => {
    const prev = [createPrimaryPerson(DEFAULT_CORE_VALUES, ASOF)]
    const edited = [{ ...prev[0], salary: 5 }]
    expect(applyPeopleEdit(prev, edited, ASOF)).toEqual(edited)
  })
})

describe('calendar age callers (E4)', () => {
  it('personCalendarAge = asOf.year - birthYear regardless of birth month', () => {
    const p = normalizePerson({ birthYear: 1986, birthMonth: 12 }, ASOF)
    expect(personCalendarAge(p, ASOF)).toBe(40)
    expect(personCalendarAge({ age: p.age, birthYear: p.birthYear }, ASOF)).toBe(calendarAge(1986, ASOF))
  })
  it('falls back to stored age when birthYear is absent (transitional)', () => {
    expect(personCalendarAge({ age: 33 } as never, ASOF)).toBe(33)
  })
  it('spouse Medicare offset uses calendar ages: primary 1986, spouse 1988 -> startAge 67 in any birth month', () => {
    for (const m of [1, 9, 12]) {
      const primary = normalizePerson({ birthYear: 1986, birthMonth: m }, ASOF)
      const spouse = normalizePerson({ birthYear: 1988, birthMonth: 13 - m }, ASOF)
      const e = spouseMedicarePartBEvent(personCalendarAge(primary, ASOF), personCalendarAge(spouse, ASOF), 0.03)
      expect(e.startAge).toBe(67)
    }
  })
})

describe('syncCoreWithPrimary uses calendar age', () => {
  it('core.currentAge = asOf.year - birthYear even when stored age disagrees', () => {
    const primary = { ...createPrimaryPerson(DEFAULT_CORE_VALUES, ASOF), age: 30, birthYear: 1980 }
    expect(syncCoreWithPrimary(DEFAULT_CORE_VALUES, [primary], ASOF).currentAge).toBe(46)
  })
})

describe('normalizePerson birthMonth edges', () => {
  it.each([0, 13, 1.5, -1, '3', NaN])('birthMonth %s normalizes to asOf.month', (bad) => {
    expect(normalizePerson({ birthYear: 1990, birthMonth: bad }, ASOF).birthMonth).toBe(9)
  })
  it.each([1, 12])('keeps valid birthMonth %s', (m) => {
    expect(normalizePerson({ birthYear: 1990, birthMonth: m }, ASOF).birthMonth).toBe(m)
  })
})

describe('applyPeopleEdit guard', () => {
  it('a salary-only edit leaves birthYear alone even when stored age disagrees with it', () => {
    const prev = [{ ...createPrimaryPerson(DEFAULT_CORE_VALUES, ASOF), age: 30, birthYear: 1980 }]
    const next = applyPeopleEdit(prev, [{ ...prev[0], salary: 1 }], ASOF)
    expect(next[0].birthYear).toBe(1980)
    expect(next[0].age).toBe(30)
  })
})
