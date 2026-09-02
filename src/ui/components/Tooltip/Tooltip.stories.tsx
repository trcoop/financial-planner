import type { Story, StoryDefault } from '@ladle/react'
import { Tooltip } from './Tooltip'

export default {
  title: 'Primitives / Tooltip',
} satisfies StoryDefault

export const Default: Story = () => (
  <div style={{ padding: 'var(--space-8)' }}>
    <Tooltip label="Why this withdrawal rate?">
      <p>The 4% rule is a common starting point for sustainable retirement withdrawals.</p>
    </Tooltip>
  </div>
)
