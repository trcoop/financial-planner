import type { Story, StoryDefault } from '@ladle/react'
import { RetirementNumberCalculator } from './RetirementNumberCalculator'

export default {
  title: 'Composite / RetirementNumberCalculator',
} satisfies StoryDefault

export const Default: Story = () => <RetirementNumberCalculator />
