import type { Story, StoryDefault } from '@ladle/react'
import { CollapsibleSection } from './CollapsibleSection'

export default {
  title: 'Composite / CollapsibleSection',
} satisfies StoryDefault

export const Collapsed: Story = () => (
  <CollapsibleSection summary="Advanced assumptions">
    <p>Inflation rate, tax rate, and other advanced settings live here.</p>
  </CollapsibleSection>
)

export const Expanded: Story = () => (
  <CollapsibleSection summary="Advanced assumptions" defaultOpen>
    <p>Inflation rate, tax rate, and other advanced settings live here.</p>
  </CollapsibleSection>
)
