import { useState } from 'react'
import type { Story, StoryDefault } from '@ladle/react'
import { LeftNav, type NavItem } from './LeftNav'

export default {
  title: 'Composite / LeftNav',
} satisfies StoryDefault

const items: NavItem[] = [
  { id: 'plan', label: 'Plan' },
  { id: 'calculators', label: 'Calculators' },
]

export const Shell: Story = () => {
  const [activeId, setActiveId] = useState('plan')
  return <LeftNav items={items} activeId={activeId} onSelect={setActiveId} />
}

export const Inline: Story = () => {
  const [activeId, setActiveId] = useState('plan')
  return (
    <LeftNav
      items={[
        { id: 'people', label: 'People' },
        { id: 'accounts', label: 'Accounts' },
        { id: 'rates', label: 'Rates' },
      ]}
      activeId={activeId}
      onSelect={setActiveId}
      variant="inline"
      ariaLabel="Profile sections"
    />
  )
}
