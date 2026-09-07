import type { Story, StoryDefault } from '@ladle/react'
import type { ProjectionRow } from '../../../engine/types'
import { ProjectionTable } from './ProjectionTable'

export default {
  title: 'Composite / ProjectionTable',
} satisfies StoryDefault

const rows: ProjectionRow[] = [
  { age: 35, year: 0, beginningBalance: 250_000, annualContribution: 12_750, investmentReturn: 17_500, annualWithdrawal: 0, endingBalance: 280_250, eventCosts: [] },
  { age: 36, year: 1, beginningBalance: 280_250, annualContribution: 13_133, investmentReturn: 19_617, annualWithdrawal: 0, endingBalance: 313_000, eventCosts: [] },
  { age: 65, year: 30, beginningBalance: 1_200_000, annualContribution: 0, investmentReturn: 84_000, annualWithdrawal: 48_000, endingBalance: 1_236_000, eventCosts: [] },
]

export const Default: Story = () => <ProjectionTable rows={rows} retirementAge={65} />
