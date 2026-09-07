import type { Story, StoryDefault } from '@ladle/react'
import type { PlanAssumptions } from '../../../engine'
import type { ChartRow } from '../../chartRow/types'
import { StressTestSection } from './StressTestSection'

export default {
  title: 'Composite / StressTestSection',
} satisfies StoryDefault

const assumptions: PlanAssumptions = {
  currentAge: 35,
  retirementAge: 67,
  initialBalance: 100_000,
  currentAnnualIncome: 80_000,
  annualContributionRate: 0.15,
  annualRaiseRate: 0.03,
  annualReturnRate: 0.07,
  inflationRate: 0.025,
  withdrawalRateInRetirement: 0.04,
  planningHorizonEndAge: 100,
}

const rows: ChartRow[] = [
  { age: 35, year: 0, beginningBalance: 100_000, annualContribution: 15_000, investmentReturn: 7_000, annualWithdrawal: 0, endingBalance: 122_000, eventCosts: [] },
]

// Default (not-yet-run) state — no orchestrator override, matching how `App.tsx` mounts this
// in production. Rendering it doesn't trigger a real Monte Carlo run; that only happens on the
// "Run Stress Test" button click / imperative handle.
export const Default: Story = () => <StressTestSection assumptions={assumptions} rows={rows} />
