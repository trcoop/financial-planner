/**
 * WP-E: household orchestration = `computeOwnAndSpousal` + death cut-offs + survivor overlay
 * (ERD §12.19.2, §12.25.1; PRD E10, E37, E41, E42). Pure; no rounding (§12.3).
 *
 * Rules applied here:
 *  - `deathMonth = birthIdx + round(deathAgeYears * 12)`; a person is paid only for months strictly
 *    BEFORE their own death month.
 *  - The first person to die is the deceased. Same-month deaths: no survivor amount is ever paid.
 *  - The survivor window is `survivorPaymentWindow(deceasedDeath, survivorDeath)`. From the deceased's
 *    death month the survivor's spousal top-up is replaced by the survivor comparison: from the later
 *    of the death month and 60y1m the household pays `max(own, survivor)`, never both. When the
 *    survivor amount wins, `own` is 0 and `survivor` holds the whole amount (matches the golden
 *    fixtures); when own wins (ties included) `survivor` is 0.
 */
import { birthMonthIndex, calculatorStartMonth } from '../age';
import { InvalidProjectionInputError } from '../errors';
import { collectingPia } from './benefit';
import { MAX_DEATH_AGE_YEARS } from './constants';
import { computeOwnAndSpousal } from './spousal';
import { paidBenefit, survivorBreakdown, survivorPaymentWindow, survivorStartMonth } from './survivor';
import type { MonthIndex, SsAnnualRow, SsInputs, SsPerson, SsResult, SsStartKind } from './types';

/** Validates `deathAgeYears` and derives each person's death month (`null` = none modeled). */
function deathMonthsOf(inputs: SsInputs): (MonthIndex | null)[] {
  const { people, deathAgeYears, asOf } = inputs;
  if (deathAgeYears === undefined) return people.map(() => null);
  if (deathAgeYears.length > people.length) {
    throw new InvalidProjectionInputError(
      'SS_SPOUSAL_INPUT_ON_SINGLE',
      'deathAgeYears has more entries than the household has people',
    );
  }
  const start = calculatorStartMonth(asOf);
  return people.map((p, i) => {
    const age = deathAgeYears[i];
    if (age === null || age === undefined) return null;
    if (!Number.isFinite(age)) {
      throw new InvalidProjectionInputError('NON_FINITE_INPUT', `deathAgeYears[${i}] must be finite (got ${age})`);
    }
    if (age > MAX_DEATH_AGE_YEARS) {
      throw new InvalidProjectionInputError('SS_INVALID_DEATH', `deathAgeYears[${i}] must be <= ${MAX_DEATH_AGE_YEARS}`);
    }
    const month = birthMonthIndex(p.birthYear, p.birthMonth) + Math.round(age * 12);
    if (month < start) {
      throw new InvalidProjectionInputError('SS_INVALID_DEATH', `deathAgeYears[${i}] puts death before the asOf month`);
    }
    return month;
  });
}

const KIND_ORDER: Record<SsStartKind, number> = { own: 0, spousal: 1, survivor: 2 };

/** Own + spousal + survivor overlay for the plan/calculator (ERD §12.25.1). */
export function computeSocialSecurity(inputs: SsInputs): SsResult {
  const base = computeOwnAndSpousal(inputs);
  const deaths = deathMonthsOf(inputs);
  if (deaths.every((d) => d === null)) return base;

  const { asOf, people, colaRate } = inputs;
  const { firstMonth, lastMonth, series } = base;
  const offset = (month: MonthIndex): number => month - firstMonth;

  // 1. Nobody is paid from their own death month on.
  deaths.forEach((d, i) => {
    if (d === null) return;
    for (let m = Math.max(d, firstMonth); m <= lastMonth; m++) series[i][offset(m)] = { own: 0, spousal: 0, survivor: 0 };
  });

  // 2. Survivor overlay (couples only; a first death that is not simultaneous with the other).
  let survivorStart: { personIndex: number; month: MonthIndex; deferredTo60: boolean } | undefined;
  const [d0, d1] = [deaths[0], deaths[1] ?? null];
  const deceasedIdx = d0 !== null && (d1 === null || d0 <= d1) ? 0 : d1 !== null ? 1 : -1;
  if (people.length === 2 && deceasedIdx >= 0) {
    const sIdx = 1 - deceasedIdx;
    const deathD = deaths[deceasedIdx] as MonthIndex;
    const deathS = deaths[sIdx];
    const window = survivorPaymentWindow(deathD, deathS);
    if (window !== null) {
      const dPerson = (people as readonly SsPerson[])[deceasedIdx] as SsPerson;
      const sPerson = (people as readonly SsPerson[])[sIdx] as SsPerson;
      const dBenefit = dPerson.benefit;
      const deceasedPia = dBenefit.kind === 'pia' ? dBenefit.pia : collectingPia(dPerson, asOf);
      const deceasedClaimMonth = dBenefit.kind === 'pia' ? (inputs.claimMonth[deceasedIdx] as MonthIndex) : dBenefit.sinceMonth;
      const start = survivorStartMonth(deathD, sPerson.birthYear, sPerson.birthMonth);
      const { amount } = survivorBreakdown({
        deceasedPia,
        deceasedBirthYear: dPerson.birthYear,
        deceasedBirthMonth: dPerson.birthMonth,
        deceasedClaimMonth,
        deathMonth: deathD,
        survivorBirthYear: sPerson.birthYear,
        survivorBirthMonth: sPerson.birthMonth,
        survivorStartMonth: start,
      });
      const last = Math.min(window.last ?? lastMonth, lastMonth);
      let firstPaid: MonthIndex | undefined;
      for (let m = Math.max(window.first, firstMonth); m <= last; m++) {
        const cell = series[sIdx][offset(m)];
        cell.spousal = 0; // replaced by the survivor comparison
        if (m < start) continue;
        const survivor = amount * (1 + colaRate) ** (Math.floor(m / 12) - asOf.year);
        if (paidBenefit(cell.own, survivor) > cell.own) {
          cell.own = 0;
          cell.survivor = survivor;
          firstPaid ??= m;
        }
      }
      if (firstPaid !== undefined) survivorStart = { personIndex: sIdx, month: firstPaid, deferredTo60: start > deathD };
    }
  }

  // 3. Annual rows re-summed from the final series (callers never re-sum).
  const annual: SsAnnualRow[] = base.annual.map((row) => {
    const perPerson = people.map((_, i) => {
      let own = 0;
      let spousal = 0;
      let survivor = 0;
      for (let k = 0; k < 12; k++) {
        const cell = series[i][row.year * 12 + k - firstMonth];
        own += cell.own;
        spousal += cell.spousal;
        survivor += cell.survivor;
      }
      return { own, spousal, survivor, total: own + spousal + survivor };
    });
    return { year: row.year, perPerson, household: perPerson.reduce((s, p) => s + p.total, 0) };
  });

  // 4. Starts: drop own/spousal starts at/after the person's death (and the survivor's spousal start
  //    at/after the deceased's death month), then add the survivor start. The survivor's OWN start stays
  //    (the own claim month is the real filing event) even when the survivor amount wins.
  const starts = base.starts.filter((s) => {
    const d = deaths[s.personIndex];
    if (d !== null && s.month >= d) return false;
    if (s.kind === 'spousal' && deceasedIdx >= 0 && s.personIndex !== deceasedIdx) {
      const deathD = deaths[deceasedIdx] as MonthIndex;
      if (s.month >= deathD) return false;
    }
    return true;
  });
  if (survivorStart) {
    starts.push(
      survivorStart.deferredTo60
        ? { personIndex: survivorStart.personIndex, kind: 'survivor', month: survivorStart.month, deferredTo60: true }
        : { personIndex: survivorStart.personIndex, kind: 'survivor', month: survivorStart.month },
    );
  }
  starts.sort((a, b) => a.month - b.month || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.personIndex - b.personIndex);

  return { firstMonth, lastMonth, series, annual, starts, deathMonths: deaths };
}
