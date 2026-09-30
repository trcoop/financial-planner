/**
 * FIN-159: regression test against frozen PolicyEngine-US 2.18.0 reference values (tax year 2026).
 *
 * 241 scenarios (single/MFJ/HOH; bracket edges, LTCG/QD ladder edges, age-65 / senior bonus,
 * FICA edges, typical cases) run through the real `computeFederalTax`. Both fixtures are static
 * and independent of tables.ts, so a bad table entry (e.g. FIN-158's stale age-65 addition) fails
 * here. See referenceFixtures/README.md for provenance, caveats, and regeneration.
 */
import { describe, expect, it } from 'vitest';
import { computeFederalTax } from './federalTax';
import type { FederalTaxInput } from './types';
import scenariosJson from './referenceFixtures/scenarios.json';
import referenceJson from './referenceFixtures/policyengine-2026.json';

interface Scenario {
  id: string;
  category: string;
  description: string;
  engineInput: FederalTaxInput;
}

interface Expected {
  incomeTax: number;
  socialSecurity: number;
  medicare: number;
  additionalMedicare: number;
  ficaTotal: number;
}

const TOLERANCE = 1;

const scenarios = scenariosJson as unknown as Scenario[];
const expected = referenceJson.expected as unknown as Record<string, Expected>;

describe('computeFederalTax vs PolicyEngine-US 2.18.0 reference (2026)', () => {
  it('has a reference entry for every scenario and vice versa', () => {
    expect(scenarios).toHaveLength(241);
    expect(new Set(scenarios.map((s) => s.id)).size).toBe(scenarios.length);
    expect(Object.keys(expected).sort()).toEqual(scenarios.map((s) => s.id).sort());
  });

  it.each(scenarios.map((s) => [s.category, s.id, s] as const))('[%s] %s', (category, id, s) => {
    const ref = expected[id]!;
    const r = computeFederalTax(s.engineInput);
    const label = `${id} (${category}: ${s.description})`;
    const near = (name: string, actual: number, want: number) =>
      expect(
        Math.abs(actual - want),
        `${label}: ${name} engine=${actual} reference=${want}`,
      ).toBeLessThanOrEqual(TOLERANCE);

    near('income tax', r.taxOwed, ref.incomeTax);
    near('FICA total', r.fica.total, ref.ficaTotal);
    near('Social Security', r.fica.socialSecurity, ref.socialSecurity);
    near('Medicare', r.fica.medicare, ref.medicare);
    near('Additional Medicare', r.fica.additionalMedicare, ref.additionalMedicare);
  });
});
