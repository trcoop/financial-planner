import { describe, expect, it } from 'vitest';

import { InvalidProjectionInputError } from './errors';
import type { ProjectionErrorCode } from './errors';
import { runProjection } from './projection';
import type { PlanAssumptions, PlanEvent } from './types';

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

  it('reduces the grown balance by the withdrawal', () => {
    expect(rows[0].endingBalance).toBeCloseTo(1_030_000, 6);
    expect(rows[1].endingBalance).toBeCloseTo(1_061_100, 6);
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
    rows.forEach((row) => expect(row.investmentReturn).toBeCloseTo(row.beginningBalance * 0.06, 6));
  });

  it('withdraws correctly from year 0, inflation-adjusted after', () => {
    expect(rows[0].annualWithdrawal).toBeCloseTo(30_000, 6);
    expect(rows[1].annualWithdrawal).toBeCloseTo(30_750, 6);
    expect(rows[0].endingBalance).toBeCloseTo(765_000, 6);
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
});
