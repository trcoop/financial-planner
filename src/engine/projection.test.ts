import { describe, expect, it } from 'vitest';

import { InvalidProjectionInputError } from './errors';
import type { ProjectionErrorCode } from './errors';
import { pipelineStages } from './pipeline';
import { runProjection } from './projection';
import type { PipelineStage, PlanAssumptions, PlanEvent } from './types';

/** The Story 1 PRD's happy-path assumptions, overridable per scenario. */
const assumptions = (overrides: Partial<PlanAssumptions> = {}): PlanAssumptions => ({
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
  ...overrides,
});

/** Asserts `runProjection` throws `InvalidProjectionInputError` carrying `code`. */
const expectRejection = (input: PlanAssumptions, code: ProjectionErrorCode): void => {
  let thrown: unknown;
  try {
    runProjection(input);
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(InvalidProjectionInputError);
  expect((thrown as InvalidProjectionInputError).code).toBe(code);
  expect((thrown as InvalidProjectionInputError).message).toBeTruthy();
};

describe('runProjection shape', () => {
  it('returns one row per year, inclusive of both endpoints', () => {
    const rows = runProjection(assumptions({ currentAge: 35, planningHorizonEndAge: 100 }));

    expect(rows).toHaveLength(66);
  });

  it('numbers years from 0 and ages from currentAge', () => {
    const rows = runProjection(assumptions({ currentAge: 35, planningHorizonEndAge: 100 }));

    expect(rows[0]).toMatchObject({ age: 35, year: 0 });
    expect(rows[65]).toMatchObject({ age: 100, year: 65 });
  });

  it('projects a single row when the horizon is the current age', () => {
    const rows = runProjection(assumptions({ currentAge: 100, retirementAge: 67, planningHorizonEndAge: 100 }));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ age: 100, year: 0 });
  });

  it('chains each year beginning balance from the prior year ending balance', () => {
    const rows = runProjection(assumptions());

    rows.slice(1).forEach((row, index) => {
      expect(row.beginningBalance).toBe(rows[index].endingBalance);
    });
  });

  it('emits every documented field on every row as a finite number', () => {
    const rows = runProjection(assumptions());

    rows.forEach((row) => {
      expect(Object.keys(row).sort()).toEqual(
        [
          'age',
          'annualContribution',
          'annualWithdrawal',
          'beginningBalance',
          'endingBalance',
          'investmentReturn',
          'year',
        ].sort(),
      );
      Object.values(row).forEach((value) => expect(Number.isFinite(value)).toBe(true));
    });
  });
});

describe('runProjection purity', () => {
  it('produces an identical projection from identical inputs', () => {
    expect(runProjection(assumptions())).toEqual(runProjection(assumptions()));
  });

  it('does not mutate the assumptions it is given', () => {
    const input = assumptions();

    runProjection(input);

    expect(input).toEqual(assumptions());
  });

  it('does not mutate the events array it is given', () => {
    const events: PlanEvent[] = [];

    runProjection(assumptions(), events);

    expect(events).toEqual([]);
  });

  it('defaults events to empty, so callers with no life events can omit them', () => {
    expect(runProjection(assumptions())).toEqual(runProjection(assumptions(), []));
  });

  it('returns a fresh rows array per call, not a shared one', () => {
    const first = runProjection(assumptions());
    const second = runProjection(assumptions());

    expect(first).not.toBe(second);
  });
});

describe('runProjection life-event threading', () => {
  /**
   * `applyLifeEvents` is a deliberate no-op until Story 3, so no projected number can reveal
   * whether `runProjection` actually hands the caller's events to the pipeline. Left unpinned,
   * FIN-19 could implement that stage perfectly and still see an empty list forever — and
   * every assertion in this file would stay green. Confirmed as a live mutation survivor
   * before this test was added.
   *
   * Probed the way `runPeriod`'s wiring test probes stage order: by swapping the *contents* of
   * `pipelineStages`, which is read through at call time.
   */
  it('hands the caller events to the stages rather than an empty list', () => {
    const mutableStages = pipelineStages as PipelineStage[];
    const realStages = [...mutableStages];
    const seen: PlanEvent[][] = [];
    const events: PlanEvent[] = [{ type: 'oneTimeExpense', atAge: 40, amount: 25_000, label: 'Roof' }];
    const probe: PipelineStage = (state, input) => {
      seen.push(input.events);
      return state;
    };

    mutableStages.splice(0, mutableStages.length, probe);

    try {
      runProjection(assumptions({ currentAge: 35, retirementAge: 67, planningHorizonEndAge: 36 }), events);
    } finally {
      mutableStages.splice(0, mutableStages.length, ...realStages);
    }

    expect(seen).toHaveLength(2);
    seen.forEach((received) => expect(received).toEqual(events));
  });
});

/**
 * The five Given/When/Then scenarios from the Story 1 PRD's Acceptance Criteria, one
 * `describe` each, asserted as written. Where a scenario leaves a rate unstated (it names
 * only the rates it is about), the happy-path default above stands in and is called out.
 */
describe('acceptance: happy path basic accumulation', () => {
  // Given age 35, retire at 67, $100k balance, $80k income, 15% contribution, 3% raises,
  // 7% returns, 2.5% inflation. When the engine projects 32 years (ages 35-66).
  const rows = runProjection(assumptions({ currentAge: 35, retirementAge: 67, planningHorizonEndAge: 66 }));

  it('projects the 32 accumulation years', () => {
    expect(rows).toHaveLength(32);
  });

  it('shows the correct year 0 contribution, on income before any raise', () => {
    expect(rows[0].annualContribution).toBeCloseTo(12_000, 6);
  });

  it('shows year 1 income with the raise applied', () => {
    // 80_000 * 1.03 = 82_400, contributed at 15% => 12_360.
    expect(rows[1].annualContribution).toBeCloseTo(12_360, 6);
  });

  it('compounds returns correctly each year', () => {
    expect(rows[0]).toMatchObject({ beginningBalance: 100_000 });
    expect(rows[0].investmentReturn).toBeCloseTo(7_000, 6);
    expect(rows[0].endingBalance).toBeCloseTo(119_000, 6);
    expect(rows[1].investmentReturn).toBeCloseTo(8_330, 6);
    expect(rows[1].endingBalance).toBeCloseTo(139_690, 6);
  });

  it('keeps every value positive through the accumulation phase', () => {
    rows.forEach((row) => {
      expect(row.beginningBalance).toBeGreaterThan(0);
      expect(row.endingBalance).toBeGreaterThan(0);
      expect(row.annualContribution).toBeGreaterThan(0);
      expect(row.investmentReturn).toBeGreaterThan(0);
    });
  });

  it('withdraws nothing while still accumulating', () => {
    rows.forEach((row) => expect(row.annualWithdrawal).toBe(0));
  });

  it('grows the balance every single year', () => {
    rows.slice(1).forEach((row, index) => {
      expect(row.endingBalance).toBeGreaterThan(rows[index].endingBalance);
    });
  });
});

describe('acceptance: immediate retirement', () => {
  // Given age 67, retire at 67, $1M balance, 4% withdrawal, 2.5% inflation. The scenario
  // does not state a return rate; the 7% default carries over.
  const rows = runProjection(
    assumptions({ currentAge: 67, retirementAge: 67, initialBalance: 1_000_000, planningHorizonEndAge: 70 }),
  );

  it('withdraws 4% of the $1M opening balance in year 0', () => {
    expect(rows[0].annualWithdrawal).toBeCloseTo(40_000, 6);
  });

  it('inflates year 1 to $41k', () => {
    expect(rows[1].annualWithdrawal).toBeCloseTo(41_000, 6);
  });

  it('shows no contributions at all', () => {
    rows.forEach((row) => expect(row.annualContribution).toBe(0));
  });

  it('grows what is left after the withdrawal, not the other way round', () => {
    // FIN-65 change 2, `(beginning - withdrawal) * (1 + r)`:
    //   year 0: (1_000_000 - 40_000) * 1.07 = 960_000 * 1.07 = 1_027_200
    //   year 1: (1_027_200 - 41_000) * 1.07 = 986_200 * 1.07 = 1_055_234
    // The old end-of-year model gave 1_030_000 and 1_061_100.
    expect(rows[0].endingBalance).toBeCloseTo(1_027_200, 6);
    expect(rows[1].endingBalance).toBeCloseTo(1_055_234, 6);
  });
});

describe('acceptance: negative balance scenario', () => {
  // Given age 60, retire at 60, $100k balance, 10% withdrawal (too aggressive), 2% returns.
  // When the engine projects 30 years (ages 60-89).
  const rows = runProjection(
    assumptions({
      currentAge: 60,
      retirementAge: 60,
      initialBalance: 100_000,
      withdrawalRateInRetirement: 0.1,
      annualReturnRate: 0.02,
      planningHorizonEndAge: 89,
    }),
  );

  it('projects all 30 years rather than stopping when the money runs out', () => {
    expect(rows).toHaveLength(30);
    expect(rows[29].age).toBe(89);
  });

  it('lets the balance go negative', () => {
    expect(rows[29].endingBalance).toBeLessThan(0);
  });

  it('never resets or floors the balance once it is negative', () => {
    const firstNegative = rows.findIndex((row) => row.endingBalance < 0);

    expect(firstNegative).toBeGreaterThan(0);
    rows.slice(firstNegative).forEach((row) => expect(row.endingBalance).toBeLessThan(0));
  });

  it('keeps producing finite, well-formed rows in the failure state', () => {
    rows.forEach((row) => {
      expect(Number.isFinite(row.endingBalance)).toBe(true);
      expect(Number.isFinite(row.annualWithdrawal)).toBe(true);
    });
  });

  it('keeps inflating the withdrawal even after the portfolio is exhausted', () => {
    expect(rows[29].annualWithdrawal).toBeGreaterThan(rows[0].annualWithdrawal);
  });
});

describe('acceptance: retirement transition mid-projection', () => {
  // Given age 58, retire at 62, $500k balance, $100k income, 20% contribution, 3% raises,
  // 7% returns. When the engine projects to age 65 (8 rows, years 0-7).
  const rows = runProjection(
    assumptions({
      currentAge: 58,
      retirementAge: 62,
      initialBalance: 500_000,
      currentAnnualIncome: 100_000,
      annualContributionRate: 0.2,
      planningHorizonEndAge: 65,
    }),
  );

  it('projects ages 58 through 65', () => {
    expect(rows).toHaveLength(8);
    expect(rows.map((row) => row.age)).toEqual([58, 59, 60, 61, 62, 63, 64, 65]);
  });

  it('shows years 0-3 contributing, growing with income', () => {
    const contributions = rows.slice(0, 4).map((row) => row.annualContribution);

    expect(contributions[0]).toBeCloseTo(20_000, 6);
    expect(contributions[1]).toBeCloseTo(20_600, 6);
    contributions.slice(1).forEach((value, index) => expect(value).toBeGreaterThan(contributions[index]));
  });

  it('withdraws nothing before the retirement year', () => {
    rows.slice(0, 4).forEach((row) => expect(row.annualWithdrawal).toBe(0));
  });

  it('stops contributing and starts withdrawing in year 4, at age 62', () => {
    expect(rows[4].age).toBe(62);
    expect(rows[4].annualContribution).toBe(0);
    expect(rows[4].annualWithdrawal).toBeGreaterThan(0);
  });

  it('rates the first withdrawal off the balance carried into the retirement year', () => {
    expect(rows[4].annualWithdrawal).toBeCloseTo(rows[3].endingBalance * 0.04, 6);
    expect(rows[4].annualWithdrawal).toBeCloseTo(29_921.6642, 4);
  });

  it('inflation-adjusts the withdrawals in years 5 and later', () => {
    rows.slice(5).forEach((row, index) => {
      expect(row.annualWithdrawal).toBeCloseTo(rows[index + 4].annualWithdrawal * 1.025, 6);
    });
  });

  it('never contributes again after the transition', () => {
    rows.slice(4).forEach((row) => expect(row.annualContribution).toBe(0));
  });
});

describe('acceptance: zero income and no contributions', () => {
  // Given age 55, retire at 55, $750k balance, $0 income, 0% contribution, 6% returns.
  // When the engine projects 20 years (ages 55-74).
  const rows = runProjection(
    assumptions({
      currentAge: 55,
      retirementAge: 55,
      initialBalance: 750_000,
      currentAnnualIncome: 0,
      annualContributionRate: 0,
      annualReturnRate: 0.06,
      planningHorizonEndAge: 74,
    }),
  );

  it('projects all 20 years', () => {
    expect(rows).toHaveLength(20);
  });

  it('contributes $0 every year', () => {
    rows.forEach((row) => expect(row.annualContribution).toBe(0));
  });

  it('grows the balance from investment returns alone', () => {
    // FIN-65 change 2: the year's return is earned on what remains after the withdrawal,
    // so it is rated against `beginningBalance - annualWithdrawal`, not `beginningBalance`.
    rows.forEach((row) =>
      expect(row.investmentReturn).toBeCloseTo((row.beginningBalance - row.annualWithdrawal) * 0.06, 6),
    );
  });

  it('withdraws correctly from year 0, inflation-adjusted after', () => {
    // year 0 ending: (750_000 - 30_000) * 1.06 = 720_000 * 1.06 = 763_200.
    // The old end-of-year model gave 765_000 (750_000 * 1.06 - 30_000).
    expect(rows[0].annualWithdrawal).toBeCloseTo(30_000, 6);
    expect(rows[1].annualWithdrawal).toBeCloseTo(30_750, 6);
    expect(rows[0].endingBalance).toBeCloseTo(763_200, 6);
  });
});

describe('runProjection performance', () => {
  it('completes a 65-year projection well inside the 10ms budget', () => {
    const input = assumptions({ currentAge: 35, planningHorizonEndAge: 100 });
    // Warm up so the measurement is not dominated by first-call JIT.
    for (let i = 0; i < 20; i += 1) runProjection(input);

    const started = performance.now();
    const runs = 50;
    for (let i = 0; i < runs; i += 1) runProjection(input);
    const averageMs = (performance.now() - started) / runs;

    expect(averageMs).toBeLessThan(10);
  });
});

describe('runProjection input validation', () => {
  it('rejects a current age past the planning horizon', () => {
    expectRejection(assumptions({ currentAge: 101, planningHorizonEndAge: 100 }), 'CURRENT_AGE_EXCEEDS_HORIZON');
  });

  it.each([
    'currentAge',
    'retirementAge',
    'initialBalance',
    'currentAnnualIncome',
    'annualContributionRate',
    'annualRaiseRate',
    'annualReturnRate',
    'inflationRate',
    'withdrawalRateInRetirement',
    'planningHorizonEndAge',
  ] as const)('rejects %s when it is NaN', (field) => {
    expectRejection(assumptions({ [field]: Number.NaN }), 'NON_FINITE_INPUT');
  });

  it.each([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('rejects an infinite input (%s)', (value) => {
    expectRejection(assumptions({ annualReturnRate: value }), 'NON_FINITE_INPUT');
  });

  it('rejects a non-number masquerading as a numeric field', () => {
    expectRejection(
      assumptions({ initialBalance: '100000' as unknown as number }),
      'NON_FINITE_INPUT',
    );
  });

  it('checks non-finite inputs before any range check, since the range checks assume finite values', () => {
    // Both NON_FINITE_INPUT and CONTRIBUTION_RATE_OUT_OF_RANGE could describe this input;
    // ERD §6 fixes the order so the code a caller sees is predictable.
    expectRejection(assumptions({ annualContributionRate: Number.NaN }), 'NON_FINITE_INPUT');
  });

  it.each(['currentAge', 'retirementAge', 'planningHorizonEndAge'] as const)('rejects a negative %s', (field) => {
    expectRejection(assumptions({ [field]: -1 }), 'NEGATIVE_AGE');
  });

  it('rejects a negative initial balance', () => {
    expectRejection(assumptions({ initialBalance: -1 }), 'NEGATIVE_BALANCE_INPUT');
  });

  it('rejects a negative income', () => {
    expectRejection(assumptions({ currentAnnualIncome: -1 }), 'NEGATIVE_INCOME');
  });

  it.each(['annualReturnRate', 'inflationRate', 'annualRaiseRate'] as const)(
    'rejects %s below -100%%',
    (field) => {
      expectRejection(assumptions({ [field]: -1.01 }), 'RATE_BELOW_NEGATIVE_100_PERCENT');
    },
  );

  it.each(['annualReturnRate', 'inflationRate', 'annualRaiseRate'] as const)(
    'accepts %s at exactly -100%%, which is a total loss rather than a sign flip',
    (field) => {
      expect(() => runProjection(assumptions({ [field]: -1 }))).not.toThrow();
    },
  );

  it.each([-0.01, 1.01])('rejects a contribution rate of %s', (rate) => {
    expectRejection(assumptions({ annualContributionRate: rate }), 'CONTRIBUTION_RATE_OUT_OF_RANGE');
  });

  it.each([0, 1])('accepts a contribution rate of %s at the range boundary', (rate) => {
    expect(() => runProjection(assumptions({ annualContributionRate: rate }))).not.toThrow();
  });

  it.each([-0.01, 1.01])('rejects a withdrawal rate of %s', (rate) => {
    expectRejection(assumptions({ withdrawalRateInRetirement: rate }), 'WITHDRAWAL_RATE_OUT_OF_RANGE');
  });

  it.each([0, 1])('accepts a withdrawal rate of %s at the range boundary', (rate) => {
    expect(() => runProjection(assumptions({ withdrawalRateInRetirement: rate }))).not.toThrow();
  });

  it('does not treat an already-retired user as an error', () => {
    expect(() => runProjection(assumptions({ currentAge: 70, retirementAge: 67 }))).not.toThrow();
  });

  it('validates before folding, so an invalid input never yields partial rows', () => {
    // A projection that validated lazily would emit rows for the valid early years before
    // tripping. Throwing is the only observable outcome.
    expect(() => runProjection(assumptions({ currentAge: 101 }))).toThrow(InvalidProjectionInputError);
  });

  it('rejects an infinite planning horizon instead of folding forever', () => {
    // The one case where validating *before* the fold is observable from outside, and the
    // reason it matters: `while (age <= Infinity)` is an unbounded synchronous loop. Nothing
    // can interrupt it — not Vitest's per-test timeout, not the worker's cancellation path —
    // so a horizon that reached the fold would wedge the thread rather than surface an error.
    // Moving the validation call below the fold makes this the only test in the suite to fail,
    // by hanging; the assertion above passes either way.
    expectRejection(assumptions({ planningHorizonEndAge: Number.POSITIVE_INFINITY }), 'NON_FINITE_INPUT');
  });
});

/**
 * FIN-55: regression tests formalizing an external formula-validation pass. An independent
 * hand-rolled re-implementation of the PRD's literal formulas —
 * `Annual_Contribution = income * contribution_pct * (1 + raise_pct)^years`,
 * `Investment_Gain = balance * return_pct`, `Withdrawals = balance * withdrawal_pct` after
 * retirement, inflation adjusting contributions/withdrawals annually — was run as a throwaway
 * Node script against these two scenarios (not committed; see the FIN-55 PR description for
 * the script), and its output is pinned here as the expected values. Written independently of
 * `runProjection`/`pipeline.ts` so a bug shared between the engine and its own test fixtures
 * cannot hide from this file.
 */
/**
 * FIN-65 scope fence. Change 1 makes the Monte Carlo historical path inflate spending at the
 * drawn year's realised CPI-U. `runProjection` must be untouched by that: it pairs a
 * user-chosen nominal return with a fixed nominal spending inflator, which is internally
 * consistent, and it never sets `inflationForPeriod` — the `??` fallback in
 * `computeWithdrawals` is what enforces it. Every figure below is hand-derivable from
 * `assumptions.inflationRate` alone, so any leak of historical CPI into the deterministic
 * projection fails here loudly.
 */
describe('FIN-65 scope fence: the deterministic projection stays on assumptions.inflationRate', () => {
  // Already-retired: $1M, 7% flat return, 2.5% flat inflation, 4% withdrawal, 3 years.
  const rows = runProjection(
    assumptions({
      currentAge: 65,
      retirementAge: 65,
      planningHorizonEndAge: 67,
      initialBalance: 1_000_000,
      currentAnnualIncome: 0,
      annualContributionRate: 0,
      annualRaiseRate: 0,
      annualReturnRate: 0.07,
      inflationRate: 0.025,
      withdrawalRateInRetirement: 0.04,
    }),
  );

  it('runs the flat-inflation spending chain, year by year', () => {
    // `ending = (beginning - w) * 1.07` — FIN-65 change 2's start-of-year withdrawal.
    // Year 0: w = 1_000_000 * 0.04 = 40_000; ending = 960_000 * 1.07 = 1_027_200.
    expect(rows[0].annualWithdrawal).toBeCloseTo(40_000, 6);
    expect(rows[0].endingBalance).toBeCloseTo(1_027_200, 6);

    // Year 1: w = 40_000 * 1.025 = 41_000; ending = (1_027_200 - 41_000) * 1.07
    //         = 986_200 * 1.07 = 1_055_234.
    expect(rows[1].annualWithdrawal).toBeCloseTo(41_000, 6);
    expect(rows[1].endingBalance).toBeCloseTo(1_055_234, 6);

    // Year 2: w = 41_000 * 1.025 = 42_025; ending = (1_055_234 - 42_025) * 1.07
    //         = 1_013_209 * 1.07 = 1_084_133.63.
    expect(rows[2].annualWithdrawal).toBeCloseTo(42_025, 6);
    expect(rows[2].endingBalance).toBeCloseTo(1_084_133.63, 6);
  });

  it('shows no trace of 1966-1968 realised CPI, which is what a leak would look like', () => {
    // Had the historical series leaked in, year 1 would spend 40_000 * 1.0277 = 41_108 and
    // year 2 would spend 41_108 * 1.0419 = 42_830.43.
    expect(rows[1].annualWithdrawal).not.toBeCloseTo(41_108, 2);
    expect(rows[2].annualWithdrawal).not.toBeCloseTo(42_830.43, 2);
  });
});

describe('FIN-55: external formula validation — deterministic scenario A (30 -> 65 accumulation)', () => {
  // 30 -> 65, $50k start, $80k income, 15% contribution, 3% raises, 7% returns, 2.5%
  // inflation, 4% withdrawal in retirement, 100-year horizon.
  const rows = runProjection(
    assumptions({
      currentAge: 30,
      retirementAge: 65,
      initialBalance: 50_000,
      currentAnnualIncome: 80_000,
      annualContributionRate: 0.15,
      annualRaiseRate: 0.03,
      annualReturnRate: 0.07,
      inflationRate: 0.025,
      withdrawalRateInRetirement: 0.04,
      planningHorizonEndAge: 100,
    }),
  );

  it('matches the hand-computed ending balance at year 0', () => {
    // beginningBalance 50,000; gain 50,000*0.07 = 3,500; contribution 80,000*0.15 = 12,000;
    // ending 50,000 + 3,500 + 12,000 = 65,500.
    expect(rows[0].endingBalance).toBeCloseTo(65_500, 6);
  });

  it('matches the hand-computed ending balance at year 1', () => {
    // income 80,000*1.03 = 82,400; contribution 82,400*0.15 = 12,360; gain 65,500*0.07 =
    // 4,585; ending 65,500 + 4,585 + 12,360 = 82,445.
    expect(rows[1].endingBalance).toBeCloseTo(82_445, 6);
  });

  it('matches the hand-computed ending balance at year 2', () => {
    // income 82,400*1.03 = 84,872; contribution 84,872*0.15 = 12,730.8; gain 82,445*0.07 =
    // 5,771.15; ending 82,445 + 5,771.15 + 12,730.8 = 100,946.95.
    expect(rows[2].endingBalance).toBeCloseTo(100_946.95, 6);
  });

  it('matches the hand-computed retirement-year withdrawal, at age 65 (year 35)', () => {
    // First retirement-year withdrawal = beginningBalance-at-retirement * 0.04. The
    // reconstructed script's year-35 beginningBalance was 2,892,644.783303949, giving a
    // withdrawal of 115,705.79133215797.
    const retirementYear = 65 - 30;
    expect(rows[retirementYear].age).toBe(65);
    expect(rows[retirementYear].annualWithdrawal).toBeCloseTo(115_705.79133215797, 6);
    // Cross-checked against the engine's own beginning balance for that year too, so this
    // assertion cannot pass merely because the hardcoded figure and the engine happen to
    // agree by coincidence at a different balance.
    expect(rows[retirementYear].annualWithdrawal).toBeCloseTo(
      rows[retirementYear].beginningBalance * 0.04,
      6,
    );
  });

  it('matches the hand-computed retirement+1 withdrawal, inflation-adjusted', () => {
    // 115,705.79133215797 * 1.025 = 118,598.43611546191.
    const retirementYear = 65 - 30;
    expect(rows[retirementYear + 1].annualWithdrawal).toBeCloseTo(118_598.43611546191, 6);
  });
});

describe('FIN-55: external formula validation — deterministic scenario B (already-retired-adjacent, high withdrawal)', () => {
  // Age 60, retiring at 62 (already-retired-adjacent), high 20% withdrawal rate driving the
  // balance negative. Confirms the deterministic engine does NOT clamp a negative balance —
  // deliberately distinct from the separately-filed chart-rendering clamping bug, which is a
  // UI display concern and untouched here.
  const rows = runProjection(
    assumptions({
      currentAge: 60,
      retirementAge: 62,
      initialBalance: 100_000,
      currentAnnualIncome: 60_000,
      annualContributionRate: 0.1,
      annualRaiseRate: 0.02,
      annualReturnRate: 0.03,
      inflationRate: 0.03,
      withdrawalRateInRetirement: 0.2,
      planningHorizonEndAge: 90,
    }),
  );

  it('matches the hand-computed first-retirement-year withdrawal formula', () => {
    // Year 2 (age 62): beginningBalance 118,390 * 0.20 = 23,678.
    const retirementYear = 62 - 60;
    expect(rows[retirementYear].age).toBe(62);
    expect(rows[retirementYear].beginningBalance).toBeCloseTo(118_390, 6);
    expect(rows[retirementYear].annualWithdrawal).toBeCloseTo(23_678, 6);
    expect(rows[retirementYear].annualWithdrawal).toBeCloseTo(
      rows[retirementYear].beginningBalance * 0.2,
      6,
    );
  });

  it('drives the balance negative and does NOT clamp it back to zero', () => {
    const firstNegative = rows.findIndex((row) => row.endingBalance < 0);

    expect(firstNegative).toBeGreaterThan(0);
    expect(rows[firstNegative].age).toBe(67);
    // FIN-65 change 2 rebaseline. Re-derived by folding
    //   ending = (beginning - w) * 1.03  (+ contribution, pre-retirement only)
    // from age 60 with w = beginningBalance-at-62 * 0.20 = 23_678, indexed 3%/yr. The
    // accumulation years and the first retirement withdrawal are untouched — only the timing
    // of the draw moved, which is why the failure year is still 67. Was -23_331.897801584084.
    expect(rows[firstNegative].endingBalance).toBeCloseTo(-28_272.77027721367, 4);
  });

  it('keeps every row after the first negative one unclamped and finite, still inflating withdrawals', () => {
    const firstNegative = rows.findIndex((row) => row.endingBalance < 0);

    rows.slice(firstNegative).forEach((row, index, negativeRows) => {
      expect(Number.isFinite(row.endingBalance)).toBe(true);
      expect(row.endingBalance).toBeLessThan(0);
      if (index > 0) {
        expect(row.annualWithdrawal).toBeGreaterThan(negativeRows[index - 1].annualWithdrawal);
      }
    });

    // Final year matches the independent reconstruction exactly, confirming no clamping
    // ever kicked in across the remaining 23 years of runaway negative compounding.
    // FIN-65 change 2 rebaseline, same re-derivation as above. Was -1_292_039.2034206502.
    expect(rows[rows.length - 1].endingBalance).toBeCloseTo(-1_339_170.193230963, 3);
  });
});
