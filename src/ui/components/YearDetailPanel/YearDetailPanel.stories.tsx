import type { Story, StoryDefault } from '@ladle/react'
import type { ChartRow } from '../../chartRow/types'
import { YearDetailPanel } from './YearDetailPanel'

export default {
  title: 'Composite / YearDetailPanel',
} satisfies StoryDefault

const row: ChartRow = {
  age: 67,
  year: 32,
  beginningBalance: 1_200_000,
  annualContribution: 0,
  investmentReturn: 84_000,
  annualWithdrawal: 48_000,
  endingBalance: 1_236_000,
  eventCosts: [],
}

export const Default: Story = () => <YearDetailPanel row={row} />
