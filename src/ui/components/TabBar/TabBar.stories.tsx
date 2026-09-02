import { useState } from 'react'
import type { Story, StoryDefault } from '@ladle/react'
import { TabBar, type TabBarTab } from './TabBar'

export default {
  title: 'Composite / TabBar',
} satisfies StoryDefault

const tabs: TabBarTab[] = [
  { id: 'projection', label: 'Projection' },
  { id: 'stress-test', label: 'Stress Test' },
  { id: 'profile', label: 'Profile' },
]

export const Default: Story = () => {
  const [activeTab, setActiveTab] = useState('projection')
  return <TabBar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />
}

export const CustomAriaLabel: Story = () => {
  const [activeTab, setActiveTab] = useState('projection')
  return <TabBar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} ariaLabel="Profile sections" />
}
