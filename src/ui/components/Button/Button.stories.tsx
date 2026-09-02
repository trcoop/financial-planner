import type { Story, StoryDefault } from '@ladle/react'
import { Button } from './Button'

export default {
  title: 'Primitives / Button',
} satisfies StoryDefault

export const Primary: Story = () => <Button variant="primary">Primary action</Button>

export const Secondary: Story = () => <Button variant="secondary">Secondary action</Button>

export const Disabled: Story = () => (
  <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
    <Button variant="primary" disabled>
      Primary
    </Button>
    <Button variant="secondary" disabled>
      Secondary
    </Button>
  </div>
)
