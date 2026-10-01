import { beforeEach, describe, expect, it } from 'vitest'
import { loadAssumptions } from './assumptionsStorage'
import { STORAGE_KEY } from './schema'

const ASOF = { year: 2026, month: 9 }

describe('loadAssumptions birth migration (injected asOf)', () => {
  beforeEach(() => localStorage.clear())

  it('legacy stored {age:40} -> birthYear 1986, birthMonth 9; second load identical', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        core: {},
        people: [{ id: 'primary', name: 'You', age: 40, retirementAge: 65, salary: 90000, isPrimary: true }],
      }),
    )
    const first = loadAssumptions(ASOF)!
    expect(first.people[0].birthYear).toBe(1986)
    expect(first.people[0].birthMonth).toBe(9)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(first))
    expect(loadAssumptions(ASOF)!.people).toEqual(first.people)
  })

  it('the migration follows the injected asOf, not the clock', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ people: [{ age: 40, isPrimary: true, id: 'primary' }] }))
    expect(loadAssumptions({ year: 2030, month: 2 })!.people[0].birthYear).toBe(1990)
  })
})
