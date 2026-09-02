import type { Story, StoryDefault } from '@ladle/react'
import { Button } from '../Button/Button'
import { StatTile } from './StatTile'

export default {
  title: 'Primitives / StatTile',
} satisfies StoryDefault

export const Default: Story = () => <StatTile label="Median ending balance" value="$1,240,000" />

export const Placeholder: Story = () => (
  <StatTile label="Stress test result" value="Run a stress test to see this" isPlaceholder />
)

export const WithAction: Story = () => (
  <StatTile label="Stress test result" value="$980,000" action={<Button variant="secondary">Re-run stress test</Button>} />
)
