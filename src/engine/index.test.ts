import { describe, expect, it } from 'vitest';

import * as engine from './index';

/**
 * The barrel is the documented public surface: downstream tickets import from
 * `src/engine`, not from the individual modules. Nothing else in this package imports
 * through it, so without these assertions a dropped re-export stays green here and
 * surfaces as a build break in a consumer's branch instead.
 */
describe('public surface', () => {
  const runtimeExports = [
    'InvalidProjectionInputError',
    'withdrawFullShortfall',
    'zeroTax',
    'applyGrowth',
    'applyLifeEvents',
    'computeIncome',
    'computeWithdrawals',
    'applyTax',
    'recordPeriod',
    'pipelineStages',
    'runStages',
    'runPeriod',
  ];

  it.each(runtimeExports)('re-exports %s', (name) => {
    expect(engine).toHaveProperty(name);
  });

  it('exports nothing beyond the documented surface', () => {
    expect(Object.keys(engine).sort()).toEqual([...runtimeExports].sort());
  });
});
