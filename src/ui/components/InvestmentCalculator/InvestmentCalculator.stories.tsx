import type { Story, StoryDefault } from '@ladle/react'
import { InvestmentCalculator } from './InvestmentCalculator'

export default {
  title: 'Composite / InvestmentCalculator',
} satisfies StoryDefault

export const Default: Story = () => <InvestmentCalculator />
