/**
 * §5.7 rounding primitives for the federal tax engine.
 *
 * All functions are pure and operate on whole-dollar/decimal conventions described in
 * `types.ts`. No React, no I/O.
 */

/** Half-up rounding, per §1(f)(7) style rounding of a single non-negative dollar figure.
 * `x >= 0` only — never called with a negative value in this engine. */
export function roundHalfUp(x: number): number {
  return Math.round(x);
}

/** §1(f)(7): truncate DOWN to the nearest multiple of `inc` (e.g. $50 or $25). */
export function truncateTo(x: number, inc: number): number {
  return Math.floor(x / inc) * inc;
}

/** Round to the NEAREST multiple of `inc` (e.g. the $300 Social Security wage base increment) —
 * the opposite direction from `truncateTo`. */
export function roundToNearest(x: number, inc: number): number {
  return Math.round(x / inc) * inc;
}

/**
 * Round every component of `components` half-up EXCEPT the largest (by unrounded value), which
 * instead receives whatever remainder is needed so the rounded components sum EXACTLY to
 * `total`: `total - sum(the other components' rounded values)`.
 *
 * Tie-break: on a tie in unrounded value, the EARLIEST index wins (is treated as "the largest"
 * and receives the remainder). This is deliberately a generic, index-based rule — this function
 * is generic over a bare array with no field names visible to it, so there is no such thing as
 * "goes to ordinaryTax" or "goes to socialSecurity" at this layer. Any domain-specific behavior
 * from that framing falls out of call-site argument order, not from anything here.
 *
 * This exists because "always give the remainder to the last/named component" produces
 * nonsensical or even negative results when that component happens to be small or zero — see
 * the counterexamples in `rounding.test.ts`.
 */
export function allocateRounding(components: readonly number[], total: number): number[] {
  if (components.length === 0) return [];

  let largestIndex = 0;
  for (let i = 1; i < components.length; i++) {
    if (components[i] > components[largestIndex]) {
      largestIndex = i;
    }
    // Tie: earliest index wins, so a strictly-greater value is required to displace it.
  }

  const rounded = components.map((c) => roundHalfUp(c));

  let sumOfOthers = 0;
  for (let i = 0; i < rounded.length; i++) {
    if (i !== largestIndex) sumOfOthers += rounded[i];
  }

  rounded[largestIndex] = total - sumOfOthers;

  return rounded;
}
