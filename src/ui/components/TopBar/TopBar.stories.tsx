import type { Story, StoryDefault } from '@ladle/react'
import { TopBar } from './TopBar'

export default {
  title: 'Composite / TopBar',
} satisfies StoryDefault

export const Default: Story = () => <TopBar />
