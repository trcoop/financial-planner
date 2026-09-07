import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlanAssumptions, PlanEvent, PortfolioAllocation, ProjectionRow } from '../../../engine'
import { RetirementSpendingTab } from './RetirementSpendingTab'
import { DEFAULT_RETIREMENT_SPENDING_VALUES, type RetirementSpendingValues } from './RetirementSpendingGoal'

afterEach(() => cleanup())

/** currentAge === retirementAge collapses `retirementNumber`'s accumulation loop to zero years,
 * so `projectedBalance` is simply `initialBalance` — deterministic reference numbers below rely
 * on this to avoid re-deriving compound-growth arithmetic in test fixtures. */
const BASE_ASSUMPTIONS: PlanAssumptions = {
  currentAge: 65,
  retirementAge: 65,
  initialBalance: 2_000_000,
  currentAnnualIncome: 0,
  annualContributionRate: 0,
  annualRaiseRate: 0,
  annualReturnRate: 0.068,
  inflationRate: 0.025,
  withdrawalRateInRetirement: 0.04,
  planningHorizonEndAge: 100,
}

const NO_ROWS: ProjectionRow[] = []
const ALLOCATION: PortfolioAllocation = { stocksPercent: 70, bondsPercent: 30 }

function renderTab(
  overrides: {
    values?: RetirementSpendingValues
    onChange?: ReturnType<typeof vi.fn<(values: RetirementSpendingValues) => void>>
    assumptions?: PlanAssumptions
    rows?: ProjectionRow[]
    events?: PlanEvent[]
    allocation?: PortfolioAllocation
    successRate?: number | null
    isStressTestStale?: boolean
    onRunStressTest?: () => void
    hasSpouse?: boolean
  } = {},
) {
  const onChange = overrides.onChange ?? vi.fn()
  const onRunStressTest = overrides.onRunStressTest ?? vi.fn()
  render(
    <RetirementSpendingTab
      values={overrides.values ?? DEFAULT_RETIREMENT_SPENDING_VALUES}
      onChange={onChange}
      assumptions={overrides.assumptions ?? BASE_ASSUMPTIONS}
      rows={overrides.rows ?? NO_ROWS}
      events={overrides.events ?? []}
      allocation={overrides.allocation ?? ALLOCATION}
      successRate={overrides.successRate ?? null}
      isStressTestStale={overrides.isStressTestStale ?? false}
      onRunStressTest={onRunStressTest}
      hasSpouse={overrides.hasSpouse ?? false}
    />,
  )
  return { onChange, onRunStressTest }
}

describe('RetirementSpendingTab — general spending goal (FIN-135)', () => {
  it('renders the general amount field and a monthly/annual frequency toggle', () => {
    renderTab()
    expect(screen.getByLabelText(/expected household expenses/i)).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: /frequency/i })).toBeInTheDocument()
  })

  it('round-trips an annual entry as annual — $60,000 redisplays as $60,000, not a derived $5,000/mo (ERD §4 round-trip contract)', () => {
    renderTab({ values: { generalAmount: 60_000, generalAmountUnit: 'annual' } })
    const field = screen.getByLabelText(/expected household expenses/i) as HTMLInputElement
    expect(field.value).toBe('$60,000')
    expect(within(screen.getByRole('radiogroup', { name: /frequency/i })).getByRole('radio', { name: 'Annual' })).toBeChecked()
  })

  it('round-trips a monthly entry as monthly', () => {
    renderTab({ values: { generalAmount: 5_000, generalAmountUnit: 'monthly' } })
    const field = screen.getByLabelText(/expected household expenses/i) as HTMLInputElement
    expect(field.value).toBe('$5,000')
    expect(within(screen.getByRole('radiogroup', { name: /frequency/i })).getByRole('radio', { name: 'Monthly' })).toBeChecked()
  })

  it('calls onChange with the raw entered amount and the currently-selected unit when the amount is edited', async () => {
    const user = userEvent.setup()
    const { onChange } = renderTab({ values: { generalAmount: 0, generalAmountUnit: 'monthly' } })

    const field = screen.getByLabelText(/expected household expenses/i)
    await user.clear(field)
    await user.type(field, '4500')

    const lastCall = onChange.mock.calls.at(-1)?.[0] as RetirementSpendingValues
    expect(lastCall.generalAmount).toBe(4500)
    expect(lastCall.generalAmountUnit).toBe('monthly')
  })

  it('converts the displayed amount when the frequency toggle is switched, preserving the real spending goal', async () => {
    const user = userEvent.setup()
    const { onChange } = renderTab({ values: { generalAmount: 5_000, generalAmountUnit: 'monthly' } })

    await user.click(within(screen.getByRole('radiogroup', { name: /frequency/i })).getByRole('radio', { name: 'Annual' }))

    const lastCall = onChange.mock.calls.at(-1)?.[0] as RetirementSpendingValues
    expect(lastCall.generalAmountUnit).toBe('annual')
    expect(lastCall.generalAmount).toBe(60_000)
  })
})

describe('RetirementSpendingTab — no duplicated rate inputs (AC)', () => {
  it('does not render inflation rate, return rate, or life expectancy inputs — those live on the Rates tab', () => {
    renderTab()
    expect(screen.queryByLabelText(/inflation/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/return/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/life expectancy/i)).not.toBeInTheDocument()
  })
})

describe('RetirementSpendingTab — Medicare lines', () => {
  it('always shows the primary Medicare Part B field, prefilled with the suggested default', () => {
    renderTab({ hasSpouse: false })
    const field = screen.getByLabelText(/^medicare part b/i) as HTMLInputElement
    expect(field).toBeInTheDocument()
    expect(field.value).toBe('$2,434.8')
  })

  it('omits the spouse Medicare field entirely when there is no spouse (not disabled — absent)', () => {
    renderTab({ hasSpouse: false })
    expect(screen.queryByLabelText(/medicare part b \(spouse\)/i)).not.toBeInTheDocument()
  })

  it('shows the spouse Medicare field, prefilled with the same suggested default, when a spouse exists', () => {
    renderTab({ hasSpouse: true })
    const field = screen.getByLabelText(/medicare part b \(spouse\)/i) as HTMLInputElement
    expect(field.value).toBe('$2,434.8')
  })

  it('uses a consistent "(you)"/"(spouse)" parenthetical pattern for both Medicare labels', () => {
    renderTab({ hasSpouse: true })
    expect(screen.getByLabelText(/medicare part b \(you\)/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/medicare part b \(spouse\)/i)).toBeInTheDocument()
  })

  it('calls onChange with an explicit override when the primary Medicare field is edited', async () => {
    const user = userEvent.setup()
    const { onChange } = renderTab()

    const field = screen.getByLabelText(/^medicare part b/i)
    await user.clear(field)
    await user.type(field, '3000')

    const lastCall = onChange.mock.calls.at(-1)?.[0] as RetirementSpendingValues
    expect(lastCall.primaryMedicareAnnualAmount).toBe(3000)
  })
})

describe('RetirementSpendingTab — Medicare suggested-amount info (FIN-135 review feedback)', () => {
  it('surfaces the CMS suggested annual amount via an accessible info affordance', () => {
    renderTab({ hasSpouse: false })
    const trigger = screen.getByRole('button', { name: /why this medicare part b amount/i })
    expect(trigger).toBeInTheDocument()
    fireEvent.click(trigger)
    // `formatCurrency` (src/ui/utils/format.ts) rounds to whole dollars, so CMS's $2,434.80/yr
    // premium renders as "$2,435/yr" here — matching the same formatting this tab's other
    // dollar figures (StatTiles, etc.) use, not a separately-formatted cents figure.
    expect(screen.getByText(/\$2,435\/yr/)).toBeInTheDocument()
  })

  it('places the info tooltip trigger right after the field label, not below the input', () => {
    renderTab({ hasSpouse: false })
    const label = screen.getByText('Medicare Part B (you)')
    const trigger = screen.getByRole('button', { name: /why this medicare part b amount/i })
    // The trigger's own wrapper (Tooltip renders its button inside a container div) is a
    // sibling of the <label> itself (NumberField's `labelAdornment` row), rather than the
    // trigger being off in a separate actions row below the input box.
    expect(trigger.parentElement?.parentElement).toBe(label.parentElement)
  })
})

describe('RetirementSpendingTab — stat tile sizing (FIN-142 review follow-up: Travis width-stability ask)', () => {
  it('renders the "Chance of success" tile outside the full-width .statTiles grid, and its wrapper width does not depend on whether the "Re-run stress test" action is present', () => {
    render(
      <RetirementSpendingTab
        values={{ generalAmount: 4_000, generalAmountUnit: 'monthly' }}
        onChange={vi.fn()}
        assumptions={BASE_ASSUMPTIONS}
        rows={NO_ROWS}
        events={[]}
        allocation={ALLOCATION}
        successRate={90}
        isStressTestStale={false}
        onRunStressTest={vi.fn()}
        hasSpouse={false}
      />,
    )
    const labelWithoutAction = screen.getByText('Chance of success')
    expect(screen.queryByRole('button', { name: /re-run stress test/i })).not.toBeInTheDocument()
    // The StatTile's own card div is `labelWithoutAction.closest('div')`; its parent is the
    // wrapper this component renders around it.
    const wrapClassWithoutAction = labelWithoutAction.closest('div')?.parentElement?.className
    cleanup()

    render(
      <RetirementSpendingTab
        values={{ generalAmount: 4_000, generalAmountUnit: 'monthly' }}
        onChange={vi.fn()}
        assumptions={BASE_ASSUMPTIONS}
        rows={NO_ROWS}
        events={[]}
        allocation={ALLOCATION}
        successRate={55}
        isStressTestStale
        onRunStressTest={vi.fn()}
        hasSpouse={false}
      />,
    )
    const labelWithAction = screen.getByText('Chance of success')
    expect(screen.getByRole('button', { name: /re-run stress test/i })).toBeInTheDocument()
    const wrapClassWithAction = labelWithAction.closest('div')?.parentElement?.className

    // Same wrapper class name in both states — its width is fixed by that class in CSS, not
    // derived from the button's own natural width, so the button's presence can't change it.
    expect(wrapClassWithoutAction).toBeTruthy()
    expect(wrapClassWithoutAction).toBe(wrapClassWithAction)
    // And it must not be the shared, full-width `.statTiles` app grid class used elsewhere.
    expect(wrapClassWithoutAction).not.toBe('statTiles')
  })
})

describe('RetirementSpendingTab — on-track readout (FIN-142 redesign: shared Monte Carlo success rate)', () => {
  it('shows a placeholder tile, not a readout, when no goal is set', () => {
    renderTab({ values: DEFAULT_RETIREMENT_SPENDING_VALUES })
    expect(screen.getByText(/set a spending goal/i)).toBeInTheDocument()
  })

  it('shows the "Run a stress test to see this" placeholder when a goal is set but successRate is null (never run)', () => {
    renderTab({ values: { generalAmount: 4_000, generalAmountUnit: 'monthly' }, successRate: null })
    expect(screen.getByText('Chance of success')).toBeInTheDocument()
    expect(screen.getByText(/run a stress test to see this/i)).toBeInTheDocument()
  })

  it('renders the lifted successRate figure directly, not a separately-computed one', () => {
    renderTab({ values: { generalAmount: 4_000, generalAmountUnit: 'monthly' }, successRate: 87 })
    expect(screen.getByText('87%')).toBeInTheDocument()
  })

  it('shows a "Re-run stress test" action only when successRate is stale and present, and wires it to onRunStressTest', async () => {
    const user = userEvent.setup()
    const { onRunStressTest } = renderTab({
      values: { generalAmount: 4_000, generalAmountUnit: 'monthly' },
      successRate: 55,
      isStressTestStale: true,
    })
    const action = screen.getByRole('button', { name: /re-run stress test/i })
    await user.click(action)
    expect(onRunStressTest).toHaveBeenCalledTimes(1)
  })

  it('does not show the "Re-run stress test" action when successRate is null even if isStressTestStale is true', () => {
    renderTab({ values: { generalAmount: 4_000, generalAmountUnit: 'monthly' }, successRate: null, isStressTestStale: true })
    expect(screen.queryByRole('button', { name: /re-run stress test/i })).not.toBeInTheDocument()
  })

  it('does not show the "Re-run stress test" action when successRate is fresh', () => {
    renderTab({ values: { generalAmount: 4_000, generalAmountUnit: 'monthly' }, successRate: 90, isStressTestStale: false })
    expect(screen.queryByRole('button', { name: /re-run stress test/i })).not.toBeInTheDocument()
  })
})

describe('RetirementSpendingTab — plan depleted callout (ERD §5/§11, inline derivation)', () => {
  it('shows nothing when the plan never depletes', () => {
    const rows: ProjectionRow[] = [
      { age: 65, year: 0, beginningBalance: 100, annualContribution: 0, investmentReturn: 5, annualWithdrawal: 4, endingBalance: 101, eventCosts: [] },
    ]
    renderTab({ rows })
    expect(screen.queryByText(/depleted/i)).not.toBeInTheDocument()
  })

  it('ignores a pre-retirement zero balance (defensive age >= retirementAge guard)', () => {
    const assumptions: PlanAssumptions = { ...BASE_ASSUMPTIONS, currentAge: 30, retirementAge: 65 }
    const rows: ProjectionRow[] = [
      { age: 30, year: 0, beginningBalance: 0, annualContribution: 0, investmentReturn: 0, annualWithdrawal: 0, endingBalance: 0, eventCosts: [] },
      { age: 65, year: 35, beginningBalance: 500, annualContribution: 0, investmentReturn: 0, annualWithdrawal: 100, endingBalance: 400, eventCosts: [] },
    ]
    renderTab({ assumptions, rows })
    expect(screen.queryByText(/depleted/i)).not.toBeInTheDocument()
  })
})

describe('RetirementSpendingTab — actionable guidance suggestions (FIN-142, Monte Carlo redesign)', () => {
  // Below the 80% Monte Carlo success-rate bar at the baseline retirement age, but resolves with
  // a few extra years of work — mirrors `retirementSolver.test.ts`'s own fixture, so
  // `computeDepletionGuidance` (which re-runs the real engine, not a mock) actually finds
  // something to suggest.
  const DEPLETED_ASSUMPTIONS: PlanAssumptions = {
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

  // The rows prop still drives the bare "Plan depleted at age X" callout (unchanged inline
  // derivation) — give it a row consistent with the assumptions above so both the callout and
  // the new suggestions render together, the way `PlanSection.tsx` threads the real `rows`.
  const DEPLETED_ROWS: ProjectionRow[] = [
    { age: 60, year: 5, beginningBalance: 100, annualContribution: 0, investmentReturn: 0, annualWithdrawal: 100, endingBalance: 0, eventCosts: [] },
  ]

  it('shows an extra-years suggestion alongside the bare depleted callout', () => {
    renderTab({ assumptions: DEPLETED_ASSUMPTIONS, rows: DEPLETED_ROWS })
    expect(screen.getByText(/plan depleted at age 60/i)).toBeInTheDocument()
    expect(screen.getByText(/you need to work.*more year.*with your current savings rate/i)).toBeInTheDocument()
  })

  it('renders no depletion callout at all for an on-track plan (review finding: mutation-tested {guidance.needsGuidance && ...} -> {true && ...} passed unmodified without this)', () => {
    renderTab()
    // Not just "the suggestion strings are absent" (which the mutation above still passes,
    // since `guidance.extraYears`/`extraContribution` stay `undefined` either way) — the
    // headline text the callout always renders when mounted must be absent too, since that's
    // what actually proves the callout itself isn't in the DOM.
    expect(screen.queryByText(/with your current savings rate/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/plan depleted/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/this plan isn't on track/i)).not.toBeInTheDocument()
  })

  it('shows "This plan isn\'t on track" when guidance is needed but no zeroed row is present in `rows` (Monte Carlo says below bar, deterministic rows didn\'t hit zero)', () => {
    renderTab({ assumptions: DEPLETED_ASSUMPTIONS, rows: NO_ROWS })
    expect(screen.getByText(/this plan isn't on track/i)).toBeInTheDocument()
  })

  it('shows an extra-monthly-contribution suggestion when a household spending goal makes the corpus size matter', () => {
    const assumptions: PlanAssumptions = {
      ...DEPLETED_ASSUMPTIONS,
      currentAge: 35,
      retirementAge: 62,
      initialBalance: 150_000,
      retirementSpendingGoal: { annualAmount: 60_000 },
    }
    const rows: ProjectionRow[] = [
      { age: 62, year: 27, beginningBalance: 100, annualContribution: 0, investmentReturn: 0, annualWithdrawal: 100, endingBalance: 0, eventCosts: [] },
    ]
    renderTab({ assumptions, rows })
    expect(screen.getByText(/save \$\d+(,\d{3})* more per month to stay on track to retire at 62/i)).toBeInTheDocument()
  })
})

describe('RetirementSpendingTab — reconciling the stat tile with the guidance callout (FIN-142 review follow-up)', () => {
  // Below the Monte Carlo bar AND the deterministic projection depletes — no disagreement to
  // reconcile, since the callout's own conditions and the tile's successRate prop both read
  // "not on track" the same way. Reuses the module-level DEPLETED_ASSUMPTIONS-shaped fixture.
  const NEEDS_GUIDANCE_ASSUMPTIONS: PlanAssumptions = {
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
  const NEEDS_GUIDANCE_ROWS: ProjectionRow[] = [
    { age: 60, year: 5, beginningBalance: 100, annualContribution: 0, investmentReturn: 0, annualWithdrawal: 100, endingBalance: 0, eventCosts: [] },
  ]

  it('shows no reconciliation note when the tile successRate itself is below 80 (no disagreement)', () => {
    renderTab({ assumptions: NEEDS_GUIDANCE_ASSUMPTIONS, rows: NEEDS_GUIDANCE_ROWS, successRate: 40 })
    expect(screen.queryByText(/chance of success figure above/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/still isn't on track because/i)).not.toBeInTheDocument()
  })

  it('shows no reconciliation note when the tile has never been run (successRate null)', () => {
    renderTab({ assumptions: NEEDS_GUIDANCE_ASSUMPTIONS, rows: NEEDS_GUIDANCE_ROWS, successRate: null })
    expect(screen.queryByText(/chance of success figure above/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/still isn't on track because/i)).not.toBeInTheDocument()
  })

  it('explains the fresh-but-disagreeing case when the tile reads >= 80 and is not stale', () => {
    renderTab({ assumptions: NEEDS_GUIDANCE_ASSUMPTIONS, rows: NEEDS_GUIDANCE_ROWS, successRate: 83, isStressTestStale: false })
    expect(screen.getByText(/still isn't on track because your plan's baseline projection/i)).toBeInTheDocument()
    expect(screen.queryByText(/chance of success figure above hasn't been updated/i)).not.toBeInTheDocument()
  })

  it('points at staleness instead when the tile reads >= 80 but is stale', () => {
    renderTab({ assumptions: NEEDS_GUIDANCE_ASSUMPTIONS, rows: NEEDS_GUIDANCE_ROWS, successRate: 83, isStressTestStale: true })
    expect(screen.getByText(/chance of success figure above hasn't been updated/i)).toBeInTheDocument()
    expect(screen.queryByText(/still isn't on track because your plan's baseline projection/i)).not.toBeInTheDocument()
  })
})
