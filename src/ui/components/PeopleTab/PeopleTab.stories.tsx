import { useState } from 'react'
import type { Story, StoryDefault } from '@ladle/react'
import { PeopleTab } from './PeopleTab'
import { createPrimaryPerson } from './Person'
import type { Person } from './Person'
import { DEFAULT_CORE_VALUES } from '../../coreInputs/defaults'

export default {
  title: 'Composite / PeopleTab',
} satisfies StoryDefault

export const Default: Story = () => {
  const [people, setPeople] = useState<Person[]>([createPrimaryPerson(DEFAULT_CORE_VALUES)])
  return <PeopleTab people={people} onChange={setPeople} />
}
