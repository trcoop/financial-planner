import { describe, expect, it } from 'vitest';
import { computeFederalTax } from './federalTax';
import { STORY_FIXTURES, type StoryScenarioName } from './storyFixtures';

const EXPECTED_SCENARIO_NAMES: StoryScenarioName[] = [
  'ZeroTax',
  'MiddleIncome',
  'TopBracket',
  'PreferentialHeavy',
  'Age65Single',
  'SeniorBonusPhaseOut',
];

describe('STORY_FIXTURES', () => {
  it('has exactly the six StoryScenarioName members as keys', () => {
    expect(Object.keys(STORY_FIXTURES).sort()).toEqual([...EXPECTED_SCENARIO_NAMES].sort());
  });

  it('ZeroTax: taxOwed === 0', () => {
    const result = computeFederalTax(STORY_FIXTURES.ZeroTax);
    expect(result.taxOwed).toBe(0);
  });

  it('MiddleIncome: at least 3 occupied ordinary bands', () => {
    const result = computeFederalTax(STORY_FIXTURES.MiddleIncome);
    const occupied = result.ordinaryBrackets.filter((b) => b.incomeInThisBracket > 0);
    expect(occupied.length).toBeGreaterThanOrEqual(3);
  });

  it('TopBracket: the Infinity band is occupied', () => {
    const result = computeFederalTax(STORY_FIXTURES.TopBracket);
    const topBand = result.ordinaryBrackets.find((b) => b.upperBound === Infinity);
    expect(topBand).toBeDefined();
    expect(topBand!.incomeInThisBracket).toBeGreaterThan(0);
  });

  it('PreferentialHeavy: taxableOrdinaryIncome === 0 and the 0% band is wider than the unshifted statutory top', () => {
    const result = computeFederalTax(STORY_FIXTURES.PreferentialHeavy);
    expect(result.taxableOrdinaryIncome).toBe(0);

    const zeroBand = result.preferentialBrackets.find((b) => b.rate === 0);
    expect(zeroBand).toBeDefined();
    // Single filer's unshifted statutory 0% top for 2026 is $49,450 (tables.ts).
    expect(zeroBand!.upperBound).toBeGreaterThan(49_450);
  });

  it('Age65Single: deduction.ageAddition > 0', () => {
    const result = computeFederalTax(STORY_FIXTURES.Age65Single);
    expect(result.deduction.ageAddition).toBeGreaterThan(0);
  });

  it('SeniorBonusPhaseOut: 0 < seniorBonusDeduction < 12_000', () => {
    const result = computeFederalTax(STORY_FIXTURES.SeniorBonusPhaseOut);
    expect(result.deduction.seniorBonusDeduction).toBeGreaterThan(0);
    expect(result.deduction.seniorBonusDeduction).toBeLessThan(12_000);
  });
});
