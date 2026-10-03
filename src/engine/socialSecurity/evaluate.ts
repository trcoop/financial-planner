/**
 * WP-E2: grid evaluation and top claims (ERD §12.25.1, §12.25.2, §12.24; PRD E30-E33). Every cell goes
 * through `evaluateScenario`, so there is exactly one definition of "lifetime total" (E30).
 */
import { birthMonthIndex, calculatorStartMonth } from '../age';
import { InvalidProjectionInputError } from '../errors';
import { EARLIEST_CLAIM_OFFSET_MONTHS, LATEST_CLAIM_OFFSET_MONTHS } from './constants';
import { makeCellEvaluator } from './gridCell';
import { evaluateScenario } from './scenario';
import { selectTopClaims } from './topClaimsSelect';
import type { MonthIndex, SsInputs, TopClaim, TopClaimsAxis } from './types';

export { findCrossings } from './crossings';
export { growthBalance } from './growth';
export { computeSocialSecurity } from './household';
export { evaluateScenario } from './scenario';

const DEFAULT_TOP_N = 3;

function axesError(message: string): InvalidProjectionInputError {
  return new InvalidProjectionInputError('SS_INVALID_CLAIM_AXES', message);
}

/** Validates `axes` against the household (ERD §12.25.2); returns the varying person indices in axis order. */
function validateAxes(base: Omit<SsInputs, 'claimMonth'>, axes: readonly TopClaimsAxis[]): number[] {
  const { people, asOf } = base;
  if (axes.length === 0) throw axesError('axes must not be empty');
  const seen = new Set<number>();
  for (const axis of axes) {
    if (!Number.isInteger(axis.personIndex) || axis.personIndex < 0 || axis.personIndex >= people.length) {
      throw axesError(`axes personIndex ${axis.personIndex} is not a person of this household`);
    }
    if (seen.has(axis.personIndex)) throw axesError(`duplicate axis for person ${axis.personIndex}`);
    seen.add(axis.personIndex);
    if (people[axis.personIndex].benefit.kind === 'collecting') {
      throw axesError(`person ${axis.personIndex} is already collecting and must not have an axis`);
    }
  }
  people.forEach((p, i) => {
    if (p.benefit.kind === 'pia' && !seen.has(i)) throw axesError(`person ${i} needs an axis`);
  });
  for (const { personIndex, months } of axes) {
    if (months.length === 0) throw axesError(`axis for person ${personIndex} has no months`);
    for (const m of months) {
      if (!Number.isFinite(m)) {
        throw new InvalidProjectionInputError('NON_FINITE_INPUT', `axis month for person ${personIndex} must be finite`);
      }
    }
    for (let k = 0; k < months.length; k++) {
      if (!Number.isInteger(months[k])) throw axesError(`axis months for person ${personIndex} must be whole months`);
      if (k > 0 && months[k] <= months[k - 1]) {
        throw axesError(`axis months for person ${personIndex} must be strictly ascending`);
      }
    }
    const person = people[personIndex];
    const birthIdx = birthMonthIndex(person.birthYear, person.birthMonth);
    if (months[0] - birthIdx < EARLIEST_CLAIM_OFFSET_MONTHS) {
      throw new InvalidProjectionInputError('SS_CLAIM_BEFORE_ELIGIBLE', `axis month for person ${personIndex} is before 62y1m`);
    }
    if (months[months.length - 1] - birthIdx > LATEST_CLAIM_OFFSET_MONTHS) {
      throw new InvalidProjectionInputError('SS_CLAIM_AFTER_70', `axis month for person ${personIndex} is after 70y0m`);
    }
    if (months[0] <= calculatorStartMonth(asOf)) {
      throw new InvalidProjectionInputError('SS_CLAIM_IN_PAST', `axis month for person ${personIndex} must be after the asOf month`);
    }
  }
  return axes.map((a) => a.personIndex);
}

/** `claimMonth` array for `SsInputs`: null for collecting people, the chosen month for varying ones. */
function claimVector(n: number, varying: readonly number[], months: readonly MonthIndex[]): (MonthIndex | null)[] {
  const out: (MonthIndex | null)[] = new Array<MonthIndex | null>(n).fill(null);
  varying.forEach((p, k) => {
    out[p] = months[k];
  });
  return out;
}

/**
 * Internal/test helper grid evaluator (no UI renders it). `grid[i][j]` is the lifetime total for
 * `axes[0].months[i]` x `axes[1].months[j]`; with a single axis the grid has ONE row over that axis.
 * Every cell equals `evaluateScenario` for the same claim months (E30).
 */
export function evaluateGrid(base: Omit<SsInputs, 'claimMonth'>, axes: TopClaimsAxis[]): number[][] {
  const varying = validateAxes(base, axes);
  const n = base.people.length;
  // The first cell goes through the real `evaluateScenario`, which validates rates, death ages and
  // benefits for the whole grid; the remaining cells use the lighter per-cell path (see gridCell.ts).
  const fast = makeCellEvaluator(base);
  let first = true;
  const total = (months: MonthIndex[]): number => {
    const claimMonth = claimVector(n, varying, months);
    if (first) {
      first = false;
      return evaluateScenario({ ...base, claimMonth });
    }
    return fast(claimMonth);
  };
  if (axes.length === 1) return [axes[0].months.map((m) => total([m]))];
  return axes[0].months.map((a) => axes[1].months.map((b) => total([a, b])));
}

/** Top-n claim combinations (n default 3), ranked and spaced per ERD §12.25.2 / §12.24. */
export function topClaims(base: Omit<SsInputs, 'claimMonth'>, axes: TopClaimsAxis[], n: number = DEFAULT_TOP_N): TopClaim[] {
  const varying = validateAxes(base, axes);
  if (!Number.isInteger(n) || n < 1) {
    throw new InvalidProjectionInputError('SS_INVALID_TOP_N', `n must be a positive integer (got ${n})`);
  }
  const grid = evaluateGrid(base, axes);
  const count = base.people.length;
  const candidates: TopClaim[] = [];
  if (axes.length === 1) {
    axes[0].months.forEach((m, j) => {
      candidates.push({ claimMonths: claimVector(count, varying, [m]), total: grid[0][j] });
    });
  } else {
    axes[0].months.forEach((a, i) => {
      axes[1].months.forEach((b, j) => {
        candidates.push({ claimMonths: claimVector(count, varying, [a, b]), total: grid[i][j] });
      });
    });
  }
  return selectTopClaims(candidates, varying, n);
}
