import { describe, expect, it } from 'vitest';

import { InvalidProjectionInputError } from './errors';
import type { ProjectionErrorCode } from './errors';
import { pipelineStages } from './pipeline';
import { realReturn, runProjection, toTodaysDollarRows, validatePlanEvents } from './projection';
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
          'eventCosts',
          'investmentReturn',
          'year',
        ].sort(),
      );
      // eventCosts is an array (always [] until WP-1b), not a numeric field.
      expect(row.eventCosts).toEqual([]);
      Object.entries(row)
        .filter(([field]) => field !== 'eventCosts')
        .forEach(([, value]) => expect(Number.isFinite(value)).toBe(true));
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

  // FIN-65 change 6 rebaseline. These three used to assert the opposite — that the balance went
  // negative and was never floored — which was the Story 1 decision this ticket reverses.
  // The acceptance criterion they exist to protect is unchanged and still holds above: the
  // engine projects all 30 years rather than stopping when the money runs out. What changed
  // is what it reports for the years after it does.
  it('floors the balance at zero rather than letting it go negative', () => {
    expect(rows[29].endingBalance).toBe(0);
  });

  it('stays at zero once exhausted, rather than compounding a deficit', () => {
    const firstZero = rows.findIndex((row) => row.endingBalance === 0);

    expect(firstZero).toBeGreaterThan(0);
    rows.slice(firstZero).forEach((row) => expect(row.endingBalance).toBe(0));
  });

  it('keeps producing finite, well-formed rows in the failure state', () => {
    rows.forEach((row) => {
      expect(Number.isFinite(row.endingBalance)).toBe(true);
      expect(Number.isFinite(row.annualWithdrawal)).toBe(true);
    });
  });

  it('reports no withdrawal at all once the portfolio is exhausted', () => {
    // The inflation-indexed spending *need* still compounds internally — `priorWithdrawal`
    // is deliberately left uncapped, see `clampRuin` — but the row reports what actually left
    // the portfolio, and nothing can leave an empty one.
    expect(rows[29].annualWithdrawal).toBe(0);
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

/** A minimal, otherwise-valid `recurringCost` event, overridable per scenario. */
const recurringCost = (
  overrides: Partial<Extract<PlanEvent, { type: 'recurringCost' }>> = {},
): Extract<PlanEvent, { type: 'recurringCost' }> => ({
  type: 'recurringCost',
  id: 'medicarePartB',
  label: 'Medicare Part B',
  startAge: 65,
  annualAmount: 2_434.8,
  growthRate: 0.055,
  ...overrides,
});

/** Asserts `validatePlanEvents` throws `InvalidProjectionInputError` carrying `code`. */
const expectEventRejection = (events: PlanEvent[], code: ProjectionErrorCode): void => {
  let thrown: unknown;
  try {
    validatePlanEvents(events);
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(InvalidProjectionInputError);
  expect((thrown as InvalidProjectionInputError).code).toBe(code);
  expect((thrown as InvalidProjectionInputError).message).toBeTruthy();
};

describe('validatePlanEvents', () => {
  it('accepts a well-formed recurringCost event', () => {
    expect(() => validatePlanEvents([recurringCost()])).not.toThrow();
  });

  it('accepts an empty events array', () => {
    expect(() => validatePlanEvents([])).not.toThrow();
  });

  it.each(['annualAmount', 'growthRate', 'startAge'] as const)('rejects %s when it is NaN', (field) => {
    expectEventRejection([recurringCost({ [field]: Number.NaN })], 'EVENT_NON_FINITE_NUMERIC_FIELD');
  });

  it.each(['endAge', 'recurrenceIntervalYears'] as const)(
    'rejects %s when it is NaN, even though it is optional',
    (field) => {
      expectEventRejection([recurringCost({ [field]: Number.NaN })], 'EVENT_NON_FINITE_NUMERIC_FIELD');
    },
  );

  it.each([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects an infinite annualAmount (%s)',
    (value) => {
      expectEventRejection([recurringCost({ annualAmount: value })], 'EVENT_NON_FINITE_NUMERIC_FIELD');
    },
  );

  it('rejects a negative startAge', () => {
    expectEventRejection([recurringCost({ startAge: -1 })], 'EVENT_NEGATIVE_AGE');
  });

  it('rejects a negative endAge', () => {
    expectEventRejection([recurringCost({ startAge: 0, endAge: -1 })], 'EVENT_NEGATIVE_AGE');
  });

  it('rejects an endAge before startAge', () => {
    expectEventRejection([recurringCost({ startAge: 70, endAge: 65 })], 'EVENT_END_BEFORE_START');
  });

  it('accepts endAge equal to startAge', () => {
    expect(() => validatePlanEvents([recurringCost({ startAge: 65, endAge: 65 })])).not.toThrow();
  });

  it('accepts an event with no endAge (runs through the horizon)', () => {
    expect(() => validatePlanEvents([recurringCost({ endAge: undefined })])).not.toThrow();
  });

  it.each([0, 2.5, -1])('rejects a recurrenceIntervalYears of %s', (value) => {
    expectEventRejection([recurringCost({ recurrenceIntervalYears: value })], 'EVENT_RECURRENCE_INTERVAL_INVALID');
  });

  it.each([1, 3])('accepts a recurrenceIntervalYears of %s', (value) => {
    expect(() => validatePlanEvents([recurringCost({ recurrenceIntervalYears: value })])).not.toThrow();
  });

  it('accepts an event with no recurrenceIntervalYears (defaults to every year)', () => {
    expect(() => validatePlanEvents([recurringCost({ recurrenceIntervalYears: undefined })])).not.toThrow();
  });

  it('rejects two events sharing the same id', () => {
    expectEventRejection(
      [recurringCost({ id: 'medicarePartB' }), recurringCost({ id: 'medicarePartB', label: 'Duplicate' })],
      'EVENT_DUPLICATE_ID',
    );
  });

  it('rejects a growthRate below -100%', () => {
    expectEventRejection([recurringCost({ growthRate: -1.01 })], 'EVENT_GROWTH_RATE_BELOW_NEGATIVE_100_PERCENT');
  });

  it('accepts a growthRate at exactly -100%', () => {
    expect(() => validatePlanEvents([recurringCost({ growthRate: -1 })])).not.toThrow();
  });

  it('does not reject a negative annualAmount', () => {
    // A negative-cost event is contrived but coherent (a cost that goes away) — ERD §6.
    expect(() => validatePlanEvents([recurringCost({ annualAmount: -100 })])).not.toThrow();
  });

  it('checks finiteness before every other recurringCost condition, per ERD §6 ordering', () => {
    // A NaN recurrenceIntervalYears trips both EVENT_NON_FINITE_NUMERIC_FIELD and (via
    // !Number.isInteger) EVENT_RECURRENCE_INTERVAL_INVALID — the finiteness code, checked
    // first, wins.
    expectEventRejection(
      [recurringCost({ recurrenceIntervalYears: Number.NaN })],
      'EVENT_NON_FINITE_NUMERIC_FIELD',
    );
  });

  it('reports EVENT_DUPLICATE_ID before EVENT_GROWTH_RATE_BELOW_NEGATIVE_100_PERCENT for a duplicate whose growth rate is also invalid', () => {
    // ERD §6 table order puts EVENT_DUPLICATE_ID ahead of the growth-rate check — a second
    // event with a reused id AND an invalid growthRate should still report the duplicate.
    expectEventRejection(
      [recurringCost({ id: 'medicarePartB' }), recurringCost({ id: 'medicarePartB', growthRate: -1.5 })],
      'EVENT_DUPLICATE_ID',
    );
  });

  it('reports EVENT_RECURRENCE_INTERVAL_INVALID for a merely non-integer, finite value', () => {
    expectEventRejection([recurringCost({ recurrenceIntervalYears: 2.5 })], 'EVENT_RECURRENCE_INTERVAL_INVALID');
  });

  it('ignores non-recurringCost event variants entirely', () => {
    const oneTime: PlanEvent = { type: 'oneTimeExpense', atAge: 40, amount: -50, label: 'Malformed but ignored' };
    expect(() => validatePlanEvents([oneTime])).not.toThrow();
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
  // Age 60, retiring at 62 (already-retired-adjacent), high 20% withdrawal rate that exhausts
  // the portfolio well inside the horizon.
  //
  // This header used to read: "Confirms the deterministic engine does NOT clamp a negative
  // balance — deliberately distinct from the separately-filed chart-rendering clamping bug,
  // which is a UI display concern and untouched here." FIN-65 change 6 moved the clamp into the
  // engine, which is what that sentence said would not happen; the chart-only fix left the
  // tooltip and the year-detail panel still quoting negative balances. Kept rather than deleted
  // so the reversal is legible: the scenario's arithmetic below is unchanged, only the reported
  // tail is.
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

  it('runs dry at 66 — exactly exhausted — and clamps that year to zero', () => {
    const firstZero = rows.findIndex((row) => row.endingBalance === 0);

    expect(firstZero).toBeGreaterThan(0);

    // 66, not the 67 this test named before FIN-65 change 6, and the difference is the point. At
    // 66 the requested draw is *exactly* the opening balance, because both sides reduce to the
    // same expression, `25_873.589906... * 1.03`: age 65 draws 25_873.589906 against a
    // beginning balance of 51_747.179812 — twice its own draw, to the cent — so it closes on
    // exactly one more year's worth, and age 66 indexes that same draw up by the 3% inflation
    // rate. Identical expression, identical double, and the year closes on exactly 0. The old assertion searched for `endingBalance < 0` and zero is not negative,
    // so it skipped the year the money actually ran out and reported the first year the
    // deficit became visible instead. Treating exactly zero as ruin is the same rule FIN-65
    // change 4 established for `runMonteCarloTrial`.
    const ruinYear = rows[firstZero];
    expect(ruinYear.age).toBe(66);
    expect(ruinYear.endingBalance).toBe(0);
    expect(ruinYear.annualWithdrawal).toBeCloseTo(ruinYear.beginningBalance, 6);

    // Nothing was cut back here — the plan funded its last draw in full, to the cent — so the
    // clamp changed no reported figure in this year beyond pinning the ending at zero.
    const requested = rows[firstZero - 1].annualWithdrawal * 1.03;
    expect(requested - ruinYear.annualWithdrawal).toBeCloseTo(0, 6);

    // 67 is where the unclamped arithmetic first printed a deficit. FIN-65 change 2 re-derived
    // that figure as -28_272.77027721367 by folding `ending = (beginning - w) * 1.03` from age
    // 60 with w = beginningBalance-at-62 * 0.20 = 23_678 indexed 3%/yr (itself a rebaseline
    // from -23_331.90 before the withdrawal-timing change). That is the number this ticket
    // exists to stop reporting.
    expect(rows[firstZero + 1].age).toBe(67);
    expect(rows[firstZero + 1].endingBalance).toBe(0);
  });

  it('reports every year after ruin as an empty portfolio, not a deepening deficit', () => {
    const firstZero = rows.findIndex((row) => row.endingBalance === 0);

    rows.slice(firstZero + 1).forEach((row) => {
      expect(row, `age ${row.age}`).toMatchObject({
        beginningBalance: 0,
        annualWithdrawal: 0,
        investmentReturn: 0,
        annualContribution: 0,
        endingBalance: 0,
      });
    });

    // FIN-65 change 6 rebaseline. The unclamped reconstruction ran to -1_339_170.193230963 by age 90
    // (itself a FIN-65 rebaseline from -1_292_039.20) — 23 years of a deficit compounding at
    // 3% on a plan with no borrowing in it. That number is what this ticket exists to stop
    // reporting; the horizon now reads zero.
    expect(rows[rows.length - 1].endingBalance).toBe(0);
  });
});


describe('realReturn', () => {
  /**
   * The Fisher relation, not the subtraction people reach for first. At 7% and 2.5% the
   * naive `nominal - inflation` gives 4.5% where the correct figure is ~4.39% — small here,
   * and compounding to a visible gap over a 65-year horizon.
   */
  it('divides out inflation rather than subtracting it', () => {
    expect(realReturn(0.07, 0.025)).toBeCloseTo(1.07 / 1.025 - 1, 12);
    expect(realReturn(0.07, 0.025)).not.toBeCloseTo(0.045, 4);
  });

  it('matches the real returns ProjectionLab publishes for its own defaults', () => {
    // Their Rates screen shows 5.34% real for a 8.5% nominal stock return (7% price + 1.5%
    // dividend) and 1.94% for a 5% bond return, both against 3% inflation.
    expect(realReturn(0.085, 0.03) * 100).toBeCloseTo(5.34, 2);
    expect(realReturn(0.05, 0.03) * 100).toBeCloseTo(1.94, 2);
  });

  it('is the nominal return when there is no inflation', () => {
    expect(realReturn(0.07, 0)).toBeCloseTo(0.07, 12);
  });

  it('goes negative when inflation outruns the return', () => {
    expect(realReturn(0.02, 0.05)).toBeLessThan(0);
  });
});

/**
 * FIN-65 change 6: a deterministic plan that runs dry flatlines at zero.
 *
 * Reverses a documented Story 1 decision (see the note this ticket rewrote on
 * `withdrawFullShortfall`): the engine used to keep projecting into negative territory on the
 * grounds that a failing plan should be shown rather than hidden. It should — but a portfolio
 * of *negative* $150,775 is not the failure being shown, it is unclamped arithmetic continuing
 * past the point the plan died, and nothing in this engine models borrowing. Flatlining at
 * zero shows the same failure and stops asserting a debt that was never simulated.
 *
 * At the shipped defaults with a 100% bond allocation the old behaviour crossed zero at age 96
 * and reported -$150,775 in today's dollars at 100. The Plan tab's y-axis floor hid that on the
 * chart, but the hover tooltip and the year-detail panel both read the row directly and showed
 * it as fact.
 *
 * This is the same decision `runMonteCarloTrial` already made at FIN-65 change 4, taken at the
 * same layer (the trial/projection loop, not the injected `WithdrawalStrategy`) so the two
 * engines stay structurally parallel and a caller-supplied strategy cannot opt out of it.
 */
describe('FIN-65 change 6: ruin is absorbing in the deterministic projection', () => {
  /** Runs dry well before the horizon: retired at 65 drawing 40% a year on a flat 4% return. */
  const ruinous: PlanAssumptions = {
    currentAge: 65,
    retirementAge: 65,
    initialBalance: 500_000,
    currentAnnualIncome: 0,
    annualContributionRate: 0,
    planningHorizonEndAge: 90,
    annualRaiseRate: 0,
    annualReturnRate: 0.04,
    inflationRate: 0.025,
    withdrawalRateInRetirement: 0.4,
  };

  it('never reports a negative ending balance', () => {
    for (const row of runProjection(ruinous)) {
      expect(row.endingBalance, `age ${row.age}`).toBeGreaterThanOrEqual(0);
    }
  });

  it('never reports a negative beginning balance', () => {
    for (const row of runProjection(ruinous)) {
      expect(row.beginningBalance, `age ${row.age}`).toBeGreaterThanOrEqual(0);
    }
  });

  it('stays at zero once it reaches zero, rather than recovering', () => {
    const rows = runProjection(ruinous);
    const ruinIndex = rows.findIndex((row) => row.endingBalance === 0);

    expect(ruinIndex).toBeGreaterThan(0);
    for (const row of rows.slice(ruinIndex)) {
      expect(row.endingBalance, `age ${row.age}`).toBe(0);
    }
  });

  it('reports zero for every component of a post-ruin year, not just the ending balance', () => {
    const rows = runProjection(ruinous);
    const ruinIndex = rows.findIndex((row) => row.endingBalance === 0);

    // The year-detail panel renders each of these; a post-ruin year that still claims a
    // withdrawal or an investment return describes activity in an empty portfolio.
    for (const row of rows.slice(ruinIndex + 1)) {
      expect(row, `age ${row.age}`).toMatchObject({
        beginningBalance: 0,
        annualWithdrawal: 0,
        investmentReturn: 0,
        annualContribution: 0,
        endingBalance: 0,
      });
    }
  });

  it('caps the final withdrawal at what the portfolio could actually fund', () => {
    const rows = runProjection(ruinous);
    const ruinIndex = rows.findIndex((row) => row.endingBalance === 0);
    const finalYear = rows[ruinIndex];

    // The year the money runs out is the one year where the requested withdrawal exceeds the
    // balance. Reporting the full request would leave the year-detail breakdown failing to add
    // up by exactly the overshoot, in the single year a user is most likely to click on.
    // What was requested that year: the prior year's draw, indexed for inflation.
    const requested = rows[ruinIndex - 1].annualWithdrawal * (1 + ruinous.inflationRate);

    expect(finalYear.annualWithdrawal).toBeLessThan(requested);
    expect(finalYear.annualWithdrawal).toBeCloseTo(finalYear.beginningBalance, 6);
  });

  it('keeps the year-detail breakdown adding up in every year, including the ruin year', () => {
    for (const row of runProjection(ruinous)) {
      expect(
        row.beginningBalance - row.annualWithdrawal + row.investmentReturn + row.annualContribution,
        `age ${row.age}`,
      ).toBeCloseTo(row.endingBalance, 6);
    }
  });

  it('leaves a plan that never runs dry completely unchanged', () => {
    // The clamp must be inert for solvent plans — this is the regression that would silently
    // rewrite every projection the app actually shows.
    const solvent: PlanAssumptions = {
      ...ruinous,
      annualReturnRate: 0.07,
      withdrawalRateInRetirement: 0.03,
    };
    const rows = runProjection(solvent);

    expect(rows.every((row) => row.endingBalance > 0)).toBe(true);
    expect(rows.at(-1)?.endingBalance).toBeGreaterThan(solvent.initialBalance);
  });

  it('reports the 100%-bond default plan flatlining at zero rather than at -$150,775', () => {
    // The exact case that prompted this ticket, in today's dollars as the Plan tab shows it.
    const defaults: PlanAssumptions = {
      currentAge: 35,
      retirementAge: 65,
      initialBalance: 250_000,
      currentAnnualIncome: 85_000,
      annualContributionRate: 0.15,
      planningHorizonEndAge: 100,
      annualRaiseRate: 0.03,
      annualReturnRate: 0.04,
      inflationRate: 0.025,
      withdrawalRateInRetirement: 0.039,
    };
    const rows = toTodaysDollarRows(runProjection(defaults), defaults.inflationRate);

    expect(rows.at(-1)?.endingBalance).toBe(0);
    expect(rows.every((row) => row.endingBalance >= 0)).toBe(true);
  });
});

describe('FIN-71: recurringCost events integrated end to end', () => {
  const medicareLike: PlanEvent = {
    type: 'recurringCost',
    id: 'medicarePartB',
    label: 'Medicare Part B',
    startAge: 65,
    annualAmount: 2_434.8,
    growthRate: 0.055,
    recurrenceIntervalYears: 1,
  };

  it('ruin-year: eventCosts is zeroed in the ruin year, matching the cut-back annualWithdrawal', () => {
    const ruinous: PlanAssumptions = {
      currentAge: 65,
      retirementAge: 65,
      initialBalance: 500_000,
      currentAnnualIncome: 0,
      annualContributionRate: 0,
      planningHorizonEndAge: 90,
      annualRaiseRate: 0,
      annualReturnRate: 0.04,
      inflationRate: 0.025,
      withdrawalRateInRetirement: 0.4,
    };
    const rows = runProjection(ruinous, [medicareLike]);
    const ruinIndex = rows.findIndex((row) => row.endingBalance === 0);

    expect(ruinIndex).toBeGreaterThan(0);
    const ruinRow = rows[ruinIndex];
    // The withdrawal was cut back below what Medicare's request would have needed, so the
    // event-cost entry is rescaled to zero right alongside it.
    expect(ruinRow.eventCosts).toEqual([{ id: 'medicarePartB', amount: 0 }]);
  });

  it('withdrawal-mechanics: today\'s-dollars annualWithdrawal strictly increases year over year once the event has started', () => {
    const plan: PlanAssumptions = {
      currentAge: 60,
      retirementAge: 60,
      initialBalance: 2_000_000,
      currentAnnualIncome: 0,
      annualContributionRate: 0,
      planningHorizonEndAge: 90,
      annualRaiseRate: 0,
      annualReturnRate: 0.07,
      inflationRate: 0.025,
      withdrawalRateInRetirement: 0.04,
    };
    const rows = toTodaysDollarRows(runProjection(plan, [medicareLike]), plan.inflationRate);
    const afterStart = rows.filter((row) => row.age >= 65);

    for (let i = 1; i < afterStart.length; i += 1) {
      expect(afterStart[i].annualWithdrawal, `age ${afterStart[i].age}`).toBeGreaterThan(
        afterStart[i - 1].annualWithdrawal,
      );
    }
  });

  it('gating: retirement age 70 — eventCosts populated for ages 65-69 with $0 contribution to annualWithdrawal, additive term first appears at 70', () => {
    const plan: PlanAssumptions = {
      currentAge: 60,
      retirementAge: 70,
      initialBalance: 1_000_000,
      currentAnnualIncome: 100_000,
      annualContributionRate: 0.15,
      planningHorizonEndAge: 90,
      annualRaiseRate: 0.03,
      annualReturnRate: 0.07,
      inflationRate: 0.025,
      withdrawalRateInRetirement: 0.04,
    };
    const rows = runProjection(plan, [medicareLike]);

    // FIN-75: the basis grows every period from plan year 0 (`currentAge`, 60), not from the
    // event's own `startAge` (65) — five dormant years (60-64) already grew it before it first
    // reports, so the exponent here is `age - currentAge`, not `age - startAge`.
    for (const age of [65, 66, 67, 68, 69]) {
      const row = rows.find((r) => r.age === age)!;
      expect(row.eventCosts.length, `age ${age}`).toBe(1);
      expect(row.eventCosts[0].amount, `age ${age}`).toBeCloseTo(
        2_434.8 * 1.055 ** (age - plan.currentAge),
        6,
      );
      expect(row.annualWithdrawal, `age ${age}`).toBe(0);
    }

    const noMedicare = runProjection(plan);
    const withMedicareAt70 = rows.find((r) => r.age === 70)!;
    const withoutMedicareAt70 = noMedicare.find((r) => r.age === 70)!;

    expect(withMedicareAt70.annualWithdrawal - withoutMedicareAt70.annualWithdrawal).toBeCloseTo(
      2_434.8 * 1.055 ** (70 - plan.currentAge),
      2,
    );
  });

  it('validatePlanEvents is enforced at runProjection\'s boundary', () => {
    expect(() =>
      runProjection(assumptions(), [{ ...medicareLike, growthRate: -2 }]),
    ).toThrow(InvalidProjectionInputError);
  });
});

describe('FIN-118: additionalIncomes — spouse income & account contributions in runProjection', () => {
  it('regression: no additionalIncomes matches pre-FIN-118 single-earner output exactly', () => {
    const plain = runProjection(assumptions());
    const withEmptyField = runProjection(assumptions({ additionalIncomes: [] }));
    const withUndefinedField = runProjection(assumptions({ additionalIncomes: undefined }));

    expect(withEmptyField).toEqual(plain);
    expect(withUndefinedField).toEqual(plain);
  });

  it('sums spouse salary and account contributions into household income/contribution before the spouse retires, and excludes both after', () => {
    const plan = assumptions({
      currentAge: 50,
      retirementAge: 67,
      currentAnnualIncome: 100_000,
      annualContributionRate: 0.1,
      planningHorizonEndAge: 60,
      additionalIncomes: [
        {
          id: 'spouse',
          currentAnnualIncome: 50_000,
          annualRaiseRate: 0.03,
          contributionRate: 0.05,
          fixedContribution: 1_000,
          // Spouse retires when the primary turns 55.
          retiresAtPrimaryAge: 55,
        },
      ],
    });
    const withSpouse = runProjection(plan);
    const primaryOnly = runProjection(assumptions({ ...plan, additionalIncomes: [] }));

    const beforeRetirement = withSpouse.find((row) => row.age === 50)!;
    const primaryOnlyAtSameAge = primaryOnly.find((row) => row.age === 50)!;
    // Primary: 100_000 * 0.1 = 10_000. Spouse: 50_000 * 0.05 + 1_000 = 3_500. Total 13_500.
    expect(beforeRetirement.annualContribution).toBeCloseTo(13_500, 6);
    expect(beforeRetirement.annualContribution).toBeGreaterThan(primaryOnlyAtSameAge.annualContribution);

    const atSpouseRetirement = withSpouse.find((row) => row.age === 55)!;
    const primaryOnlyAtSpouseRetirement = primaryOnly.find((row) => row.age === 55)!;
    // Once the spouse retires, contribution reverts to exactly the primary-only figure.
    expect(atSpouseRetirement.annualContribution).toBeCloseTo(primaryOnlyAtSpouseRetirement.annualContribution, 6);
  });

  it('pins the retiresAtPrimaryAge boundary: the spouse still contributes at age retiresAtPrimaryAge - 1 and stops exactly at age retiresAtPrimaryAge', () => {
    // Targets pipeline.ts's `state.age >= person.retiresAtPrimaryAge` check directly, at the
    // exact boundary row rather than "some row after retirement" — an off-by-one mutation to
    // `>` would leave the spouse contributing one extra year, and only asserting the row at
    // age === retiresAtPrimaryAge (not a later age) catches that.
    const plan = assumptions({
      currentAge: 50,
      retirementAge: 67,
      currentAnnualIncome: 100_000,
      annualContributionRate: 0.1,
      planningHorizonEndAge: 60,
      additionalIncomes: [
        {
          id: 'spouse',
          currentAnnualIncome: 50_000,
          annualRaiseRate: 0.03,
          contributionRate: 0.05,
          fixedContribution: 1_000,
          retiresAtPrimaryAge: 55,
        },
      ],
    });
    const withSpouse = runProjection(plan);
    const primaryOnly = runProjection(assumptions({ ...plan, additionalIncomes: [] }));

    const lastWorkingYear = withSpouse.find((row) => row.age === 54)!;
    const primaryOnlyAtLastWorkingYear = primaryOnly.find((row) => row.age === 54)!;
    expect(lastWorkingYear.annualContribution).toBeGreaterThan(primaryOnlyAtLastWorkingYear.annualContribution);

    const firstRetiredYear = withSpouse.find((row) => row.age === 55)!;
    const primaryOnlyAtFirstRetiredYear = primaryOnly.find((row) => row.age === 55)!;
    expect(firstRetiredYear.annualContribution).toBeCloseTo(primaryOnlyAtFirstRetiredYear.annualContribution, 6);
  });

  it('FIN-118 review fix: a primary fixed-dollar contribution reaches the projection', () => {
    const plain = runProjection(assumptions());
    const withFixed = runProjection(assumptions({ primaryFixedContribution: 5_000 }));

    const plainRow = plain.find((row) => row.age === 35)!;
    const fixedRow = withFixed.find((row) => row.age === 35)!;
    expect(fixedRow.annualContribution).toBeCloseTo(plainRow.annualContribution + 5_000, 6);
  });

  it('regression: primaryFixedContribution absent matches pre-fix output exactly', () => {
    const plain = runProjection(assumptions());
    const withUndefinedField = runProjection(assumptions({ primaryFixedContribution: undefined }));

    expect(withUndefinedField).toEqual(plain);
  });

  it('rejects a non-finite primaryFixedContribution at the input boundary', () => {
    expectRejection(assumptions({ primaryFixedContribution: Number.NaN }), 'NON_FINITE_INPUT');
  });

  it('rejects a non-finite field on an additionalIncomes entry at the input boundary', () => {
    expectRejection(
      assumptions({
        additionalIncomes: [
          {
            id: 'spouse',
            currentAnnualIncome: Number.NaN,
            annualRaiseRate: 0.03,
            contributionRate: 0.1,
            fixedContribution: 0,
            retiresAtPrimaryAge: 65,
          },
        ],
      }),
      'NON_FINITE_INPUT',
    );
  });
});

describe('FIN-138: retirementSpendingGoal-driven drawdown', () => {
  it('rejects a non-finite retirementSpendingGoal.annualAmount at the input boundary', () => {
    expectRejection(assumptions({ retirementSpendingGoal: { annualAmount: Number.NaN } }), 'NON_FINITE_INPUT');
    expectRejection(
      assumptions({ retirementSpendingGoal: { annualAmount: Number.POSITIVE_INFINITY } }),
      'NON_FINITE_INPUT',
    );
  });

  it('withdraws the goal, inflated to the first retirement year, instead of the flat rate', () => {
    const withGoal = runProjection(assumptions({ retirementSpendingGoal: { annualAmount: 60_000 } }));

    const firstRetiredYear = withGoal.find((row) => row.age === 67)!;
    // currentAge 35 -> retirementAge 67 is 32 plan years: 60_000 * 1.025^32.
    expect(firstRetiredYear.annualWithdrawal).toBeCloseTo(60_000 * 1.025 ** 32, 6);
  });

  it('uses the goal as-is (no inflation) when already retired at plan year 0', () => {
    const withGoal = runProjection(
      assumptions({ currentAge: 67, retirementAge: 67, retirementSpendingGoal: { annualAmount: 60_000 } }),
    );

    const firstRetiredYear = withGoal.find((row) => row.age === 67)!;
    expect(firstRetiredYear.annualWithdrawal).toBeCloseTo(60_000, 6);
  });

  it('regression: retirementSpendingGoal absent reproduces the rate-driven output bit-for-bit', () => {
    const plain = runProjection(assumptions());
    const withUndefinedField = runProjection(assumptions({ retirementSpendingGoal: undefined }));

    expect(withUndefinedField).toEqual(plain);
  });
});
