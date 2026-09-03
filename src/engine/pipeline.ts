/**
 * The per-period pipeline: a fixed, named stage sequence run once per projected year.
 *
 * The stage order is the architectural commitment (Engine Architecture Design, Pipeline /
 * step function). Later stories extend the engine by filling in stages, swapping strategy
 * implementations, or adding `PlanEvent` types — not by reordering this list. It has been
 * reordered exactly once, at FIN-65 change 2, to move retirement withdrawals ahead of growth;
 * see {@link pipelineStages} for the decision and what deliberately did *not* move with it.
 *
 * Every stage carries its Story 1 accumulation and drawdown behaviour (ERD §5, WP-1b), with
 * the sole exception of {@link applyLifeEvents}, which stays an intentional no-op until
 * Story 3 gives `PlanEvent` a meaning. The horizon is deliberately not represented here:
 * folding these stages across a range of years is `runProjection`'s job, which is what lets
 * Monte Carlo reuse the same step function with a per-period return.
 */

import type { AdditionalIncome, PeriodState, PipelineStage, PlanAssumptions, RunPeriodInput } from './types';

/**
 * Whether a period falls in the drawdown phase.
 *
 * `>=`, so the retirement year itself is a drawdown year. Already-retired users
 * (`retirementAge <= currentAge`) are therefore in drawdown from year 0 — a valid, supported
 * scenario rather than an input error (Story 1 PRD, Edge Cases).
 */
const isRetired = (age: number, assumptions: PlanAssumptions): boolean => age >= assumptions.retirementAge;

/**
 * Whether the HOUSEHOLD has begun drawing down the portfolio.
 *
 * Distinct from {@link isRetired}, which stays a per-earner check (used by `computeIncome` to
 * stop each earner's own income/contribution at their own retirement age). This gate answers a
 * different question — has *every* earner the household relied on for income stopped working —
 * and is `>=` the LATEST retirement age in the household: the primary's own
 * `assumptions.retirementAge`, or any {@link AdditionalIncome.retiresAtPrimaryAge} (FIN-118),
 * whichever comes last on the primary's age timeline.
 *
 * FIN-118 wired each additional earner's own income/contribution to stop at their own
 * `retiresAtPrimaryAge`, but left `computeWithdrawals` gated solely on the primary's
 * `retirementAge` — so a spouse retiring a year before the primary correctly stopped earning,
 * yet the household still didn't draw down the portfolio for that gap year even though it
 * should have started drawing down for the primary's retirement alone regardless.
 *
 * Decided (2026-09-02, FIN-118 follow-up bug report): no partial/shortfall withdrawal during a
 * gap year where one earner has retired but another hasn't — the household draws zero from the
 * portfolio until EVERY earner has individually reached their own retirement age, full stop.
 * This deliberately sidesteps a real complication (a younger spouse may be too young to
 * withdraw from tax-advantaged accounts without an early-withdrawal penalty before 59½) by not
 * withdrawing at all until every earner has retired — account-type/penalty-aware withdrawal
 * timing and any true income-shortfall-driven partial withdrawal remain deferred to a future
 * ticket, not built here.
 */
const isHouseholdRetired = (age: number, assumptions: PlanAssumptions): boolean => {
  const retirementAges = [
    assumptions.retirementAge,
    ...(assumptions.additionalIncomes ?? []).map((person) => person.retiresAtPrimaryAge),
  ];
  return age >= Math.max(...retirementAges);
};

/**
 * Records the balance the period opened with, before any stage has touched it.
 *
 * Its own stage as of FIN-65 change 2. It used to be a side-obligation of {@link applyGrowth},
 * which was fine only while growth ran first; now that {@link computeWithdrawals} precedes
 * growth and needs the *opening* balance to rate the first retirement year, the snapshot has
 * to be taken before either of them. {@link recordPeriod} reads it back, and it is not
 * recoverable once `balance` has been reduced by a withdrawal.
 */
export const snapshotBeginningBalance: PipelineStage = (state, _input) => ({
  ...state,
  beginningBalance: state.balance,
});

/**
 * Grows the balance by this period's return.
 *
 * Runs on whatever the balance is when it is reached — as of FIN-65 change 2 that is the
 * balance net of this year's retirement withdrawal, so the year's growth applies to
 * `beginningBalance - withdrawal`. Stores the computed `investmentReturn` dollar amount for
 * {@link recordPeriod}, which is not recoverable once `balance` is overwritten with the
 * post-growth value.
 */
export const applyGrowth: PipelineStage = (state, input) => ({
  ...state,
  // Stated against the period's own return, not `assumptions.annualReturnRate`: the
  // deterministic projection is just the case where the two are equal every year, while a
  // Monte Carlo trial varies `returnForPeriod` per period through this same stage.
  investmentReturn: state.balance * input.returnForPeriod,
  // `x * (1 + r)` rather than `x + investmentReturn` to match ERD §5's ending-balance
  // formula literally — the two differ in the last bit or two under IEEE-754.
  balance: state.balance * (1 + input.returnForPeriod),
});

/**
 * Applies any `recurringCost` life events active this period (Events & Medicare Cost ERD §5),
 * and grows every such event's running cost basis (FIN-75).
 *
 * The basis (`state.eventCostBasis`, per event id) grows every period from plan year 0 onward —
 * whether or not the event is currently active — by that period's applicable rate:
 * `eventGrowthOverrides`'s entry for the event's id (Monte Carlo's historical branch) when
 * present, else the event's own static `growthRate` (the deterministic projection and the GBM
 * branch). Year 0 is the base year and applies no growth (`annualAmount` is already stated as of
 * year 0); every period after that grows the PRIOR period's basis by the CURRENT period's rate —
 * `priorBasis * (1 + rate)` — the same chaining pattern `computeWithdrawals` uses for
 * `priorWithdrawal`, so a historically-sampled event's amount is the true product of each
 * period's own drawn rate rather than a single rate re-exponentiated from the flat base every
 * period. `createInitialPeriodState` seeds `eventCostBasis` empty; a missing entry here falls
 * back to `event.annualAmount`, which is what makes year 0 (and any state built without a
 * pre-seeded basis) read as the unaged starting figure.
 *
 * Reporting is unaffected by the growth-every-period rule: an event only lands an `eventCosts`
 * entry when it is active (`startAge`/`endAge`) AND on-interval
 * (`(age - startAge) % interval === 0`) — a period that is active but off-interval contributes
 * nothing and is *absent* from `eventCosts` this period (not a `{ id, amount: 0 }` entry; see
 * ERD §5's resolution), even though its basis still grew this period. When reported, the amount
 * is the grown basis as of this period — never recomputed from `annualAmount` by exponentiating
 * elapsed active years, which is the bug this fixes: that formula gave a dormant event zero
 * growth pre-`startAge`, and re-derived from the flat base every period once active instead of
 * chaining.
 *
 * `retirementEventCostTotal` is the sum of every entry landed in `eventCosts` this period — see
 * `PeriodState.retirementEventCostTotal`'s doc comment for why it is kept as its own field
 * rather than inlined at the `computeWithdrawals` call site.
 */
export const applyLifeEvents: PipelineStage = (state, input) => {
  const eventCostBasis = new Map(state.eventCostBasis);
  const eventCosts: { id: string; amount: number }[] = [];

  for (const event of input.events) {
    if (event.type !== 'recurringCost') {
      continue;
    }

    const rate = input.eventGrowthOverrides?.get(event.id) ?? event.growthRate;
    const priorBasis = state.eventCostBasis.get(event.id) ?? event.annualAmount;
    const basis = state.year === 0 ? priorBasis : priorBasis * (1 + rate);
    eventCostBasis.set(event.id, basis);

    const active = state.age >= event.startAge && (event.endAge === undefined || state.age <= event.endAge);
    if (!active) {
      continue;
    }

    const interval = event.recurrenceIntervalYears ?? 1;
    const onInterval = (state.age - event.startAge) % interval === 0;
    if (!onInterval) {
      continue;
    }

    eventCosts.push({ id: event.id, amount: basis });
  }

  return {
    ...state,
    eventCosts,
    eventCostBasis,
    retirementEventCostTotal: eventCosts.reduce((sum, entry) => sum + entry.amount, 0),
  };
};

/**
 * One {@link AdditionalIncome} entry's income and contribution for this period, plus its
 * updated raise-chain value to carry into `additionalPriorIncomes` (FIN-118).
 *
 * Mirrors the primary's own pre-retirement/retirement branch in {@link computeIncome} exactly,
 * but keyed off `retiresAtPrimaryAge` (expressed on the primary's age timeline, same offset
 * technique as `spouseMedicarePartBEvent`) instead of `assumptions.retirementAge` — each
 * additional earner retires on their own schedule, not the primary's.
 */
const computeAdditionalIncome = (
  person: AdditionalIncome,
  state: PeriodState,
): { income: number; contribution: number } => {
  const retired = state.age >= person.retiresAtPrimaryAge;
  if (retired) {
    return { income: 0, contribution: 0 };
  }

  const priorIncome = state.additionalPriorIncomes.get(person.id) ?? 0;
  const income =
    state.year === 0 ? person.currentAnnualIncome : priorIncome * (1 + person.annualRaiseRate);
  const contribution = income * person.contributionRate + person.fixedContribution;

  return { income, contribution };
};

/**
 * Computes this period's income and contribution.
 *
 * Pre-retirement only: year 0 uses `currentAnnualIncome` as-is, later years apply
 * `annualRaiseRate` to the prior year's income. Contributions are 0 in retirement.
 *
 * FIN-118: `assumptions.additionalIncomes` (a spouse's salary and their owned accounts'
 * contributions, or any other household earner) is summed on top of the primary's own
 * income/contribution here. Each entry retires on its own schedule (`retiresAtPrimaryAge`),
 * tracked via its own slot in `additionalPriorIncomes` rather than folded into the primary's
 * `priorIncome` — a household total would double-count once an additional earner's raise
 * chained off it. Absent/empty `additionalIncomes` reproduces the pre-FIN-118 single-earner
 * output exactly (the regression case).
 */
export const computeIncome: PipelineStage = (state, input) => {
  const { assumptions } = input;
  const additionalIncomes = assumptions.additionalIncomes ?? [];

  // Retirement has no earned income in Story 1's model, so the raise chain is a
  // pre-retirement concern only. Income is zeroed rather than frozen at its last working
  // value so that `priorIncome` always reads as "income earned this period".
  const primaryRetired = isRetired(state.age, assumptions);
  const primaryIncome = primaryRetired
    ? 0
    : // Raises start in year 1: year 0 is the user's income as entered today.
      state.year === 0
      ? assumptions.currentAnnualIncome
      : state.priorIncome * (1 + assumptions.annualRaiseRate);
  // FIN-118 review fix: `primaryFixedContribution` is additive on top of the percentage-rate
  // contribution, the same way each `AdditionalIncome.fixedContribution` is additive on top of
  // its own `contributionRate` below — it exists so a primary account in fixed-dollar
  // contribution mode (see `syncCoreWithPrimaryAccount`) has a path into the engine at all.
  // `?? 0` keeps every pre-existing percentage-only plan (the field absent) byte-identical.
  const primaryContribution = primaryRetired
    ? 0
    : primaryIncome * assumptions.annualContributionRate + (assumptions.primaryFixedContribution ?? 0);

  const additionalPriorIncomes = new Map<string, number>();
  let totalContribution = primaryContribution;

  for (const person of additionalIncomes) {
    const { income, contribution } = computeAdditionalIncome(person, state);
    additionalPriorIncomes.set(person.id, income);
    totalContribution += contribution;
  }

  return {
    ...state,
    priorIncome: primaryIncome,
    additionalPriorIncomes,
    annualContribution: totalContribution,
    // Contributions land at year end and so earn no return in the year they are made
    // (Story 1 PRD, Edge Cases) — hence added after `applyGrowth`, not before it.
    balance: state.balance + totalContribution,
  };
};

/**
 * Determines this period's intended withdrawal and asks the withdrawal strategy to source it.
 *
 * Retirement only: the first retirement year withdraws
 * `balanceAtStartOfFirstRetirementYear * withdrawalRateInRetirement` — or, when
 * `assumptions.retirementSpendingGoal` is set (FIN-138), that goal's today's-dollars
 * `annualAmount` inflated forward by `state.year` years instead — and every year after
 * inflates the prior withdrawal by this period's inflation rate, regardless of which of the
 * two first-year formulas produced it.
 *
 * **Runs BEFORE {@link applyGrowth} as of FIN-65 change 2**, so a retirement year resolves as
 * `(beginningBalance - withdrawal) * (1 + r)`: the retiree takes the year's spending money out
 * at the start of the year, and only what is left is invested. This is the model Bengen (1994)
 * and the Trinity study use, and the change is worth roughly +0.15pp to +0.25pp of SAFEMAX.
 *
 * There are three distinct published models here and we are choosing the middle one on
 * purpose, so do not "fix" this back:
 *
 * - end-of-year (what this engine did before): `1_000_000 * 1.07 - 40_000` = $1,030,000
 * - **start-of-year, ours**: `(1_000_000 - 40_000) * 1.07` = $1,027,200
 * - monthly time-weighted (e.g. ProjectionLab): ~$1,028,499
 *
 * Ours is the most conservative of the three, by about $1,300/yr on $1M at 7%. That is a
 * deliberate preference for the simpler, directly-published Bengen/Trinity convention over a
 * finer-grained model whose extra precision we cannot independently validate.
 */
export const computeWithdrawals: PipelineStage = (state, input) => {
  const { assumptions, withdrawalStrategy } = input;

  if (!isHouseholdRetired(state.age, assumptions)) {
    return { ...state, annualWithdrawal: 0 };
  }

  /**
   * The period's own inflation when the caller knows it, the plan's flat assumption otherwise
   * (FIN-65).
   *
   * The `??` fallback is load-bearing, not defensive coding — it is the whole scope fence
   * between the two kinds of caller:
   *
   * - Monte Carlo's *historical* path sets `inflationForPeriod` to the realised CPI-U of the
   *   very historical year it drew this period's return from. Pairing them is what the
   *   safe-withdrawal-rate literature does (Bengen 1994, Trinity); leaving them unpaired ran
   *   nominal 1970s returns against a placid invented 2.5% cost of living, which does not
   *   merely bias the mean — it inverts the cohort ranking.
   * - The deterministic projection (`runProjection`, the Plan tab) and Monte Carlo's GBM
   *   branch have no historical year to key off, so they never set it and stay on
   *   `assumptions.inflationRate`. The Plan tab pairing a user-chosen nominal return with a
   *   user-chosen nominal inflator is internally consistent, and FIN-65 must not leak into it.
   *
   * `??` and not `||`: 1929's CPI-U is exactly 0.0000, which `||` would silently replace with
   * the plan's rate.
   */
  const inflationRate = input.inflationForPeriod ?? assumptions.inflationRate;

  // `priorWithdrawal === null` is what marks the first retirement year, so this works
  // identically whether retirement is reached mid-projection or was already underway at
  // year 0. The first year rates `beginningBalance` — the balance at the *start* of the
  // year, per ERD §5 — which `snapshotBeginningBalance` captured before this stage ran.
  // The base (non-event) spending need — this is the figure `priorWithdrawal` tracks and
  // compounds. `state.retirementEventCostTotal` (Events & Medicare Cost ERD §5) is added on
  // top of it below, but deliberately AFTER `priorWithdrawal` is set from `baseRequested`
  // alone: if the combined total fed back into `priorWithdrawal`, an event's own growth rate
  // would get inflation-compounded a second time on top of itself every subsequent year — the
  // "no feedback loop" requirement (ERD §5, PRD Round 1 decision 3).
  // FIN-138: when a `retirementSpendingGoal` is set, the FIRST retirement year draws that
  // goal (today's dollars) inflated forward by `state.year` years — the number of inflation
  // years between year-0 today's-dollars and the nominal dollars needed in this, the first
  // retirement year. Deliberately keyed off `assumptions.inflationRate`, not `inflationRate`
  // above (which may be a Monte Carlo historical-path override for THIS period's own
  // compounding) — the goal is a today's-dollars figure fixed at plan creation, so converting
  // it to nominal dollars must use the plan's own flat assumption, the same way every other
  // year-0-relative figure in this engine does. Every subsequent year needs no special case:
  // `state.priorWithdrawal * (1 + inflationRate)` below already carries a nominal first-year
  // figure forward correctly regardless of which branch produced it. Falls back to the
  // existing rate-driven formula when no goal is set (`undefined` = no goal, unchanged
  // behavior) — see `PlanAssumptions.retirementSpendingGoal`.
  const baseRequested =
    state.priorWithdrawal === null
      ? assumptions.retirementSpendingGoal
        ? assumptions.retirementSpendingGoal.annualAmount * (1 + assumptions.inflationRate) ** state.year
        : state.beginningBalance * assumptions.withdrawalRateInRetirement
      : state.priorWithdrawal * (1 + inflationRate);

  const requested = baseRequested + state.retirementEventCostTotal;

  const plan = withdrawalStrategy(state, requested);

  return {
    ...state,
    // The *requested* base figure compounds, never the sourced one: this models a spending
    // need that rises with inflation whether or not the portfolio could fund last year's draw.
    // See `PeriodState.priorWithdrawal` (resolved 2026-08-15, FIN-15 review). Base only, not
    // `requested` (which includes this period's event costs) — see the comment above.
    priorWithdrawal: baseRequested,
    // The row reports, and the balance is reduced by, what actually left the portfolio —
    // includes this period's event costs, additively.
    annualWithdrawal: plan.amount,
    balance: state.balance - plan.amount,
  };
};

/** Applies tax owed on this period's income and withdrawals. Zero for Stories 1-3. */
export const applyTax: PipelineStage = (state, input) => {
  const { taxOwed } = input.taxCalculator(state.priorIncome, state.annualWithdrawal, {
    age: state.age,
    year: state.year,
  });

  // Always zero for Stories 1-3, so this subtraction is a no-op today. It is wired anyway so
  // that swapping in real bracket math is an implementation change behind the existing
  // interface, not a pipeline change.
  return { ...state, balance: state.balance - taxOwed };
};

/** Appends this period's `ProjectionRow` to the accumulated output. */
export const recordPeriod: PipelineStage = (state, _input) => ({
  ...state,
  // A projection of the state the earlier stages built, with no arithmetic of its own —
  // every figure here was computed by the stage that owns it. A new array rather than a
  // push, so the state handed in is never mutated.
  rows: [
    ...state.rows,
    {
      age: state.age,
      year: state.year,
      beginningBalance: state.beginningBalance,
      annualContribution: state.annualContribution,
      investmentReturn: state.investmentReturn,
      annualWithdrawal: state.annualWithdrawal,
      endingBalance: state.balance,
      eventCosts: state.eventCosts,
    },
  ],
});

/**
 * The pipeline's fixed stage order.
 *
 * `snapshotBeginningBalance -> applyLifeEvents -> computeWithdrawals -> applyGrowth ->
 *  computeIncome -> applyTax -> recordPeriod`
 *
 * **Changed once, deliberately, at FIN-65 change 2** — the doc comment at the top of this file
 * calls the order an architectural commitment, so this is recorded as a decision rather than
 * left as a shuffle. Retirement withdrawals now come *out of the portfolio before* the year's
 * growth is applied, which is what Bengen (1994) and the Trinity study both model. The
 * `beginningBalance` snapshot moved into its own leading stage to make that possible; see
 * {@link snapshotBeginningBalance} and the note in {@link computeWithdrawals}.
 *
 * `computeIncome` deliberately stayed *after* `applyGrowth`, exactly where it was. Its
 * placement encodes a separate Story 1 decision — contributions land at year end and earn no
 * return in the year they are made — and letting a withdrawal-timing change quietly relocate
 * contributions too would be a second behavioural change riding along unannounced.
 */
export const pipelineStages: readonly PipelineStage[] = [
  snapshotBeginningBalance,
  applyLifeEvents,
  computeWithdrawals,
  applyGrowth,
  computeIncome,
  applyTax,
  recordPeriod,
];

/** Folds an ordered list of stages over a state, feeding each stage the previous one's output. */
export const runStages = (
  stages: readonly PipelineStage[],
  state: PeriodState,
  input: RunPeriodInput,
): PeriodState => stages.reduce((current, stage) => stage(current, input), state);

/**
 * Runs one period of the plan: the engine's core step function.
 *
 * Deliberately synchronous and free of any knowledge of workers or cancellation — Tier 2's
 * cancel-on-input-change behaviour lives in the worker orchestration layer, not here. Monte
 * Carlo reuses this same step function, varying only `input.returnForPeriod` per period,
 * rather than reimplementing the projection.
 */
export const runPeriod = (state: PeriodState, input: RunPeriodInput): PeriodState =>
  runStages(pipelineStages, state, input);
