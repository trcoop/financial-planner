import { useState } from 'react'
import type { Story, StoryDefault } from '@ladle/react'
import type { PlanAssumptions, PortfolioAllocation, ProjectionRow } from '../../../engine'
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

const ALLOCATION: PortfolioAllocation = { stocksPercent: 70, bondsPercent: 30 }

/** Wraps `RetirementSpendingTab` with local `values` state — Ladle stories render the real,
 * controlled component rather than a static snapshot of its output. `successRate`/`isStressTestStale`
 * mirror the `PlanSection.tsx`-lifted state this component actually receives in the app: a story can
 * pass `successRate={null}` for the "never run a stress test yet" placeholder state, or a number
 * (optionally with `isStressTestStale`) for the "Chance of success" readout states. */
function Wrapper({
  assumptions,
  rows,
  successRate = null,
  isStressTestStale = false,
}: {
  assumptions: PlanAssumptions
  rows: ProjectionRow[]
  successRate?: number | null
  isStressTestStale?: boolean
}) {
  const [values, setValues] = useState<RetirementSpendingValues>(GOAL_VALUES)
  return (
    <RetirementSpendingTab
      values={values}
      onChange={setValues}
      assumptions={assumptions}
      rows={rows}
      allocation={ALLOCATION}
      successRate={successRate}
      isStressTestStale={isStressTestStale}
      onRunStressTest={() => {}}
      hasSpouse={false}
    />
  )
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

export const OnTrack: Story = () => <Wrapper assumptions={ON_TRACK_ASSUMPTIONS} rows={[]} successRate={92} />

export const DepletedBothSuggestions: Story = () => (
  <Wrapper assumptions={DEPLETED_BOTH_ASSUMPTIONS} rows={depletedRow(DEPLETED_BOTH_ASSUMPTIONS.retirementAge)} successRate={41} />
)

export const DepletedExtraYearsOnly: Story = () => (
  <Wrapper assumptions={DEPLETED_YEARS_ONLY_ASSUMPTIONS} rows={depletedRow(DEPLETED_YEARS_ONLY_ASSUMPTIONS.retirementAge)} successRate={58} />
)

// The user has never run a stress test this session — `successRate` is `null`, so the "Chance of
// success" tile falls back to its placeholder value (same pattern as the Projection tab's tile),
// while the depletion guidance callout below it still resolves independently (FIN-142: the
// guidance solver runs its own low-precision Monte Carlo search regardless of whether a full
// stress test has ever been run).
export const StressTestNeverRun: Story = () => (
  <Wrapper assumptions={DEPLETED_YEARS_ONLY_ASSUMPTIONS} rows={depletedRow(DEPLETED_YEARS_ONLY_ASSUMPTIONS.retirementAge)} successRate={null} />
)

// `successRate` was computed against an earlier version of the plan's inputs and is now stale —
// the "Chance of success" tile shows a "Re-run stress test" action, same affordance as the
// Projection tab's own tile.
export const StressTestStale: Story = () => (
  <Wrapper
    assumptions={DEPLETED_YEARS_ONLY_ASSUMPTIONS}
    rows={depletedRow(DEPLETED_YEARS_ONLY_ASSUMPTIONS.retirementAge)}
    successRate={58}
    isStressTestStale
  />
)
