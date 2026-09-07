import { useState } from 'react'
import type { Story, StoryDefault } from '@ladle/react'
import type { PlanAssumptions, ProjectionRow } from '../../../engine'
import { RetirementSpendingTab } from './RetirementSpendingTab'
import { DEFAULT_RETIREMENT_SPENDING_VALUES, type RetirementSpendingValues } from './RetirementSpendingGoal'

export default {
  title: 'Composite / RetirementSpendingTab',
} satisfies StoryDefault

const GOAL_VALUES: RetirementSpendingValues = {
  ...DEFAULT_RETIREMENT_SPENDING_VALUES,
  generalAmount: 5_000,
  generalAmountUnit: 'monthly',
}

/** Wraps `RetirementSpendingTab` with local `values` state — Ladle stories render the real,
 * controlled component rather than a static snapshot of its output. */
function Wrapper({ assumptions, rows }: { assumptions: PlanAssumptions; rows: ProjectionRow[] }) {
  const [values, setValues] = useState<RetirementSpendingValues>(GOAL_VALUES)
  return <RetirementSpendingTab values={values} onChange={setValues} assumptions={assumptions} rows={rows} hasSpouse={false} />
}

const ON_TRACK_ASSUMPTIONS: PlanAssumptions = {
  currentAge: 40,
  retirementAge: 65,
  initialBalance: 400_000,
  currentAnnualIncome: 150_000,
  annualContributionRate: 0.15,
  annualRaiseRate: 0.02,
  annualReturnRate: 0.068,
  inflationRate: 0.025,
  withdrawalRateInRetirement: 0.04,
  planningHorizonEndAge: 100,
}

// Depletes well before the horizon at its own retirement age via `runProjection`, so FIN-142's
// `computeDepletionGuidance` (which re-runs the real engine) resolves both an extra-years and an
// extra-monthly-contribution suggestion — same fixture shape as `retirementSolver.test.ts`'s
// "both resolve" case.
const DEPLETED_BOTH_ASSUMPTIONS: PlanAssumptions = {
  currentAge: 35,
  retirementAge: 62,
  initialBalance: 150_000,
  currentAnnualIncome: 90_000,
  annualContributionRate: 0.06,
  annualRaiseRate: 0.02,
  annualReturnRate: 0.05,
  inflationRate: 0.025,
  withdrawalRateInRetirement: 0.06,
  planningHorizonEndAge: 90,
  retirementSpendingGoal: { annualAmount: 60_000 },
}

// The corpus is scale-invariant under a pure percentage `withdrawalRateInRetirement` (see
// `retirementSolver.test.ts`'s comment on this), so only the extra-years suggestion resolves —
// no household spending goal here, unlike the fixture above.
const DEPLETED_YEARS_ONLY_ASSUMPTIONS: PlanAssumptions = {
  currentAge: 55,
  retirementAge: 60,
  initialBalance: 100_000,
  currentAnnualIncome: 90_000,
  annualContributionRate: 0.06,
  annualRaiseRate: 0.02,
  annualReturnRate: 0.05,
  inflationRate: 0.025,
  withdrawalRateInRetirement: 0.06,
  planningHorizonEndAge: 90,
}

/** A single row with a zeroed `endingBalance` at/after `retirementAge` is all the bare callout's
 * own inline derivation needs — the real depletion age it displays comes from this row, while
 * the two suggestion lines come from `computeDepletionGuidance` re-running the real engine. */
const depletedRow = (age: number): ProjectionRow[] => [
  { age, year: age, beginningBalance: 100, annualContribution: 0, investmentReturn: 0, annualWithdrawal: 100, endingBalance: 0, eventCosts: [] },
]

export const OnTrack: Story = () => <Wrapper assumptions={ON_TRACK_ASSUMPTIONS} rows={[]} />

export const DepletedBothSuggestions: Story = () => (
  <Wrapper assumptions={DEPLETED_BOTH_ASSUMPTIONS} rows={depletedRow(DEPLETED_BOTH_ASSUMPTIONS.retirementAge)} />
)

export const DepletedExtraYearsOnly: Story = () => (
  <Wrapper assumptions={DEPLETED_YEARS_ONLY_ASSUMPTIONS} rows={depletedRow(DEPLETED_YEARS_ONLY_ASSUMPTIONS.retirementAge)} />
)
