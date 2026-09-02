import type { Story, StoryDefault } from '@ladle/react'
import { Card } from './Card'

export default {
  title: 'Primitives / Card',
} satisfies StoryDefault

export const DefaultPadding: Story = () => (
  <Card>
    <p>Default padding content.</p>
  </Card>
)

export const CompactPadding: Story = () => (
  <Card padding="compact">
    <p>Compact padding content.</p>
  </Card>
)
