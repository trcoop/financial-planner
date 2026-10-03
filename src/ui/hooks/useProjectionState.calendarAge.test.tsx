import type { ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useProjectionState } from './useProjectionState'
import { FrozenAsOfProvider } from '../AsOfContext'
import { TEST_ASOF } from '../../testAsOf'
import { DEFAULT_CORE_VALUES } from '../coreInputs/defaults'
import { DEFAULT_ADVANCED_VALUES } from '../components/AdvancedAssumptionsForm/defaults'
import type { Person } from '../components'

const wrapper = ({ children }: { children: ReactNode }) => (
  <FrozenAsOfProvider asOf={TEST_ASOF}>{children}</FrozenAsOfProvider>
)

// Stored `age` (30) deliberately disagrees with birthYear 1980 (calendar age 46 at 2026).
const SPOUSE: Person = {
  id: 'spouse-1',
  name: 'Spouse',
  age: 30,
  birthYear: 1980,
  birthMonth: 4,
  retirementAge: 65,
  salary: 50_000,
  isPrimary: false,
}

describe('useProjectionState uses calendar age (asOf.year - birthYear), not stored age', () => {
  const core = { ...DEFAULT_CORE_VALUES, currentAge: 35 }

  it('spouse Medicare startAge = currentAge + (65 - 46)', () => {
    const { result } = renderHook(() => useProjectionState(core, DEFAULT_ADVANCED_VALUES, 0, [SPOUSE], []), { wrapper })
    const event = result.current.events.find((e) => 'id' in e && e.id === 'medicareSpousePartB')
    expect(event).toMatchObject({ startAge: 35 + (65 - 46) })
  })

  it('spouse retiresAtPrimaryAge = currentAge + (retirementAge - 46)', () => {
    const { result } = renderHook(() => useProjectionState(core, DEFAULT_ADVANCED_VALUES, 0, [SPOUSE], []), { wrapper })
    expect(result.current.assumptions.additionalIncomes?.[0].retiresAtPrimaryAge).toBe(35 + (65 - 46))
  })
})
