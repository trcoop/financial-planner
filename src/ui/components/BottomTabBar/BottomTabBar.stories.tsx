import { useState } from 'react'
import type { Story, StoryDefault } from '@ladle/react'
import { BottomTabBar } from './BottomTabBar'
import type { NavItem } from '../LeftNav/LeftNav'
import { ChartIcon } from '../icons/ChartIcon'
import { GridIcon } from '../icons/GridIcon'

export default {
  title: 'Composite / BottomTabBar',
} satisfies StoryDefault

const items: NavItem[] = [
  { id: 'plan', label: 'Plan', icon: ChartIcon },
  { id: 'calculators', label: 'Calculators', icon: GridIcon },
]

export const Default: Story = () => {
  const [activeId, setActiveId] = useState('plan')
  return <BottomTabBar items={items} activeId={activeId} onSelect={setActiveId} />
}
