import { useState } from 'react'
import type { Story, StoryDefault } from '@ladle/react'
import { PeopleTab } from './PeopleTab'
import { createPrimaryPerson } from './Person'
import type { Person } from './Person'
import { DEFAULT_CORE_VALUES } from '../../coreInputs/defaults'
import { TEST_ASOF } from '../../../testAsOf'

export default {
  title: 'Composite / PeopleTab',
} satisfies StoryDefault

export const Default: Story = () => {
  const [people, setPeople] = useState<Person[]>([createPrimaryPerson(DEFAULT_CORE_VALUES, TEST_ASOF)])
  return <PeopleTab people={people} onChange={setPeople} />
}

/** Pre-FIN-162 record: no birth month/year, so both fields show a required error. */
export const MissingBirth: Story = () => {
  const [people, setPeople] = useState<Person[]>([
    { id: 'primary', name: 'You', age: 40, retirementAge: 65, salary: 90_000, isPrimary: true },
  ])
  return <PeopleTab people={people} onChange={setPeople} />
}
