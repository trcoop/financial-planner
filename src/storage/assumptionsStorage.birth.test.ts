import { beforeEach, describe, expect, it } from 'vitest'
import { loadAssumptions } from './assumptionsStorage'
import { STORAGE_KEY } from './schema'

const ASOF = { year: 2026, month: 9 }

describe('loadAssumptions does not repair or migrate people', () => {
  beforeEach(() => localStorage.clear())

  it('a legacy {age} record loads with no birth fields invented, and nothing is written back', () => {
    const raw = JSON.stringify({
      core: {},
      people: [{ id: 'primary', name: 'You', age: 40, retirementAge: 65, isPrimary: true }],
    })
    localStorage.setItem(STORAGE_KEY, raw)
    const loaded = loadAssumptions(ASOF)!
    expect(loaded.people[0]).toEqual({ id: 'primary', name: 'You', age: 40, retirementAge: 65, isPrimary: true })
    expect(localStorage.getItem(STORAGE_KEY)).toBe(raw)
  })

  it('a record with birth fields keeps them as stored', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ people: [{ id: 'primary', age: 40, birthYear: 1500, birthMonth: 99, isPrimary: true }] }),
    )
    expect(loadAssumptions(ASOF)!.people[0]).toMatchObject({ birthYear: 1500, birthMonth: 99 })
  })
})
