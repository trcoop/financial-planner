import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEY } from './schema'
import { clearAssumptions, loadAssumptions, saveAssumptions } from './assumptionsStorage'
import { DEFAULT_CORE_VALUES } from '../ui/components/CoreInputsForm/defaults'
import { DEFAULT_ADVANCED_VALUES } from '../ui/components/AdvancedAssumptionsForm/defaults'

/** Minimal in-memory fake matching the `Storage` interface, swapped in for `window.localStorage`
 * per-test so tests don't depend on jsdom's real localStorage implementation (and so we can
 * make it throw on demand for the error-handling ACs). */
function createFakeStorage(initial: Record<string, string> = {}): Storage {
  const store = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size
    },
  }
}

function createThrowingStorage(methods: Partial<Record<'getItem' | 'setItem' | 'removeItem', boolean>>): Storage {
  const base = createFakeStorage()
  return {
    ...base,
    getItem: methods.getItem
      ? () => {
          throw new Error('storage disabled')
        }
      : base.getItem,
    setItem: methods.setItem
      ? () => {
          throw new Error('quota exceeded')
        }
      : base.setItem,
    removeItem: methods.removeItem
      ? () => {
          throw new Error('storage disabled')
        }
      : base.removeItem,
  }
}

let warnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  warnSpy.mockRestore()
  vi.unstubAllGlobals()
})

describe('saveAssumptions / loadAssumptions round-trip', () => {
  it('saves and loads back the exact values written', () => {
    const fake = createFakeStorage()
    vi.stubGlobal('localStorage', fake)

    const core = { ...DEFAULT_CORE_VALUES, currentAge: 40 }
    const advanced = { ...DEFAULT_ADVANCED_VALUES, annualReturnPercent: 6 }
    saveAssumptions(core, advanced)

    expect(loadAssumptions()).toEqual({ core, advanced })
  })

  it('round-trips the FIN-56 stock/bond allocation field', () => {
    const fake = createFakeStorage()
    vi.stubGlobal('localStorage', fake)

    const core = DEFAULT_CORE_VALUES
    const advanced = { ...DEFAULT_ADVANCED_VALUES, stocksAllocationPercent: 85 }
    saveAssumptions(core, advanced)

    expect(loadAssumptions()).toEqual({ core, advanced })
    expect(loadAssumptions()?.advanced.stocksAllocationPercent).toBe(85)
  })

  it('round-trips the FIN-57 bond return assumption field', () => {
    const fake = createFakeStorage()
    vi.stubGlobal('localStorage', fake)

    const core = DEFAULT_CORE_VALUES
    const advanced = { ...DEFAULT_ADVANCED_VALUES, bondReturnPercent: 5.5 }
    saveAssumptions(core, advanced)

    expect(loadAssumptions()).toEqual({ core, advanced })
    expect(loadAssumptions()?.advanced.bondReturnPercent).toBe(5.5)
  })

  it('writes under the versioned STORAGE_KEY', () => {
    const fake = createFakeStorage()
    vi.stubGlobal('localStorage', fake)

    saveAssumptions(DEFAULT_CORE_VALUES, DEFAULT_ADVANCED_VALUES)

    expect(fake.getItem(STORAGE_KEY)).not.toBeNull()
  })
})

describe('loadAssumptions edge cases', () => {
  it('returns undefined when no key has ever been saved', () => {
    vi.stubGlobal('localStorage', createFakeStorage())
    expect(loadAssumptions()).toBeUndefined()
  })

  it('returns undefined for corrupted/unparseable JSON', () => {
    vi.stubGlobal('localStorage', createFakeStorage({ [STORAGE_KEY]: '{not valid json' }))
    expect(loadAssumptions()).toBeUndefined()
  })

  it('returns undefined when the parsed value is not an object', () => {
    vi.stubGlobal('localStorage', createFakeStorage({ [STORAGE_KEY]: '"just a string"' }))
    expect(loadAssumptions()).toBeUndefined()
  })

  it('partially merges when core/advanced are missing fields (schema drift)', () => {
    const partial = JSON.stringify({ core: { currentAge: 50 }, advanced: {} })
    vi.stubGlobal('localStorage', createFakeStorage({ [STORAGE_KEY]: partial }))

    expect(loadAssumptions()).toEqual({
      core: { ...DEFAULT_CORE_VALUES, currentAge: 50 },
      advanced: DEFAULT_ADVANCED_VALUES,
    })
  })

  it('fills in hasSpouse/spouseAge defaults for a record persisted before FIN-113', () => {
    // Simulates a pre-FIN-113 persisted record that predates the spouse fields entirely.
    const preSpouseCore = JSON.stringify({
      core: {
        currentAge: 40,
        retirementAge: 65,
        initialBalance: 100000,
        currentAnnualIncome: 90000,
        annualContributionRatePercent: 10,
      },
      advanced: {},
    })
    vi.stubGlobal('localStorage', createFakeStorage({ [STORAGE_KEY]: preSpouseCore }))

    const loaded = loadAssumptions()
    expect(loaded?.core.hasSpouse).toBe(DEFAULT_CORE_VALUES.hasSpouse)
    expect(loaded?.core.spouseAge).toBe(DEFAULT_CORE_VALUES.spouseAge)
  })

  it('falls back to defaults per-field when core/advanced are object-shaped but wrong type', () => {
    const wrongType = JSON.stringify({ core: 'not an object', advanced: ['also', 'wrong'] })
    vi.stubGlobal('localStorage', createFakeStorage({ [STORAGE_KEY]: wrongType }))

    expect(loadAssumptions()).toEqual({
      core: DEFAULT_CORE_VALUES,
      advanced: DEFAULT_ADVANCED_VALUES,
    })
  })

  it('returns undefined when getItem throws (storage disabled / private mode)', () => {
    vi.stubGlobal('localStorage', createThrowingStorage({ getItem: true }))
    expect(loadAssumptions()).toBeUndefined()
    expect(warnSpy).not.toHaveBeenCalled()
  })
})

describe('saveAssumptions error handling', () => {
  it('swallows and warns when setItem throws (quota exceeded)', () => {
    vi.stubGlobal('localStorage', createThrowingStorage({ setItem: true }))

    expect(() => saveAssumptions(DEFAULT_CORE_VALUES, DEFAULT_ADVANCED_VALUES)).not.toThrow()
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })
})

describe('clearAssumptions', () => {
  it('removes the stored key', () => {
    const fake = createFakeStorage()
    vi.stubGlobal('localStorage', fake)
    saveAssumptions(DEFAULT_CORE_VALUES, DEFAULT_ADVANCED_VALUES)

    clearAssumptions()

    expect(fake.getItem(STORAGE_KEY)).toBeNull()
  })

  it('swallows when removeItem throws', () => {
    vi.stubGlobal('localStorage', createThrowingStorage({ removeItem: true }))
    expect(() => clearAssumptions()).not.toThrow()
  })
})
