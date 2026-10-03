/**
 * Growth on benefits (PRD E12, ERD §12.1). Effective annual rate `r`, applied monthly as
 * `g = (1+r)^(1/12)`; each benefit lands at month end and earns no growth in its own month:
 * `bal(m) = bal(m-1) * g + benefit(m)`. The nominal `r/12` convention is wrong here.
 */
import { InvalidProjectionInputError } from '../errors';
import { MAX_GROWTH_RATE } from './constants';

/** Throws unless `growthRate` is `null` or a finite rate in 0..MAX_GROWTH_RATE. */
export function validateGrowthRate(growthRate: number | null): void {
  if (growthRate === null) return;
  if (!Number.isFinite(growthRate)) {
    throw new InvalidProjectionInputError('NON_FINITE_INPUT', `growthRate must be a finite number (got ${growthRate})`);
  }
  if (growthRate < 0 || growthRate > MAX_GROWTH_RATE) {
    throw new InvalidProjectionInputError(
      'SS_INVALID_GROWTH_RATE',
      `growthRate must be null or within 0..${MAX_GROWTH_RATE} (got ${growthRate})`,
    );
  }
}

/** Cumulative month-end balance; `null` rate = plain cumulative sum. Output has the input's length. */
export function growthBalance(monthlyHousehold: readonly number[], growthRate: number | null): number[] {
  validateGrowthRate(growthRate);
  const g = growthRate === null ? 1 : (1 + growthRate) ** (1 / 12);
  const out: number[] = new Array<number>(monthlyHousehold.length);
  let bal = 0;
  for (let i = 0; i < monthlyHousehold.length; i++) {
    const b = monthlyHousehold[i];
    if (!Number.isFinite(b)) {
      throw new InvalidProjectionInputError('NON_FINITE_INPUT', `monthlyHousehold[${i}] must be finite (got ${b})`);
    }
    bal = bal * g + b;
    out[i] = bal;
  }
  return out;
}
