/**
 * Lighter per-cell path for `evaluateGrid` (ERD §12.25.1, PRD E30, O2 perf budget). It computes the same
 * number as `evaluateScenario` (own + spousal + survivor series -> calculator slice from the asOf month ->
 * growth recursion) with the same floating-point operations in the same order, but without allocating the
 * full `SsResult` per cell and with everything that does not depend on the claim months hoisted out.
 *
 * It does NOT validate: the caller validates the axes and runs the first cell through the real
 * `evaluateScenario` (which validates rates, death ages, benefits). The exhaustive grid-vs-scenario test
 * (`evaluate.test.ts`) is the guard that this path never drifts from `evaluateScenario`.
 */
import { birthMonthIndex, calculatorStartMonth } from '../age';
import { collectingPia, fraMonths, ownFactorAt } from './benefit';
import { spousalAmount } from './spousal';
import { paidBenefit, survivorBreakdown, survivorPaymentWindow, survivorStartMonth } from './survivor';
import type { MonthIndex, SsInputs, SsPerson } from './types';

interface Member {
  person: SsPerson;
  pia: number;
  birthIdx: number;
  fra: number;
  /** Own start for a collecting person; claim-dependent (set per cell) otherwise. */
  fixedStart: MonthIndex | null;
  death: MonthIndex | null;
}

/** Builds `(claimMonth) => lifetime total`, equal to `evaluateScenario({ ...base, claimMonth })`. */
export function makeCellEvaluator(base: Omit<SsInputs, 'claimMonth'>): (claimMonth: (MonthIndex | null)[]) => number {
  const { asOf, people, colaRate, growthRate, endYear, deathAgeYears } = base;
  const n = people.length;
  const members: Member[] = people.map((person, i) => {
    const age = deathAgeYears?.[i] ?? null;
    const birthIdx = birthMonthIndex(person.birthYear, person.birthMonth);
    return {
      person,
      pia: person.benefit.kind === 'pia' ? person.benefit.pia : collectingPia(person, asOf),
      birthIdx,
      fra: fraMonths(person.birthYear),
      fixedStart: person.benefit.kind === 'collecting' ? person.benefit.sinceMonth : null,
      death: age === null ? null : birthIdx + Math.round(age * 12),
    };
  });

  const firstMonth = asOf.year * 12;
  const lastMonth = endYear * 12 + 11;
  const yearCount = endYear - asOf.year + 1;
  const start = calculatorStartMonth(asOf);
  const cola: number[] = Array.from({ length: yearCount }, (_, y) => (1 + colaRate) ** y);
  const g = growthRate === null ? 1 : (1 + growthRate) ** (1 / 12);

  // Survivor overlay: depends only on the deaths (claim-independent) except the deceased's claim month.
  const [d0, d1] = [members[0].death, n === 2 ? members[1].death : null];
  const deceasedIdx = d0 !== null && (d1 === null || d0 <= d1) ? 0 : d1 !== null ? 1 : -1;
  const survivorWindow =
    n === 2 && deceasedIdx >= 0
      ? survivorPaymentWindow(members[deceasedIdx].death as MonthIndex, members[1 - deceasedIdx].death)
      : null;
  const sIdx = 1 - deceasedIdx;
  const survivorFrom = survivorWindow === null ? 0 : Math.max(survivorWindow.first, firstMonth);
  const survivorLast = survivorWindow === null ? -1 : Math.min(survivorWindow.last ?? lastMonth, lastMonth);
  const survivorBegin =
    survivorWindow === null
      ? 0
      : survivorStartMonth(
          members[deceasedIdx].death as MonthIndex,
          members[sIdx].person.birthYear,
          members[sIdx].person.birthMonth,
        );

  const ownVal = new Float64Array(n);
  const spousalVal = new Float64Array(n);
  const ownFrom = new Array<number>(n);
  const spousalFrom = new Array<number>(n);

  return (claimMonth) => {
    for (let i = 0; i < n; i++) ownFrom[i] = members[i].fixedStart ?? (claimMonth[i] as MonthIndex);
    const spousalBase = [0, 0];
    for (let i = 0; i < n; i++) {
      const m = members[i];
      if (n === 2) {
        const other = members[1 - i];
        spousalFrom[i] = Math.max(ownFrom[i], ownFrom[1 - i]);
        spousalBase[i] = spousalAmount({
          ownPia: m.pia,
          otherPia: other.pia,
          ownFraMonths: m.birthIdx + m.fra,
          spousalStart: spousalFrom[i],
        });
      } else {
        spousalFrom[i] = Number.POSITIVE_INFINITY;
      }
    }

    let survivorAmount = 0;
    if (survivorWindow !== null) {
      const d = members[deceasedIdx];
      const s = members[sIdx];
      survivorAmount = survivorBreakdown({
        deceasedPia: d.pia,
        deceasedBirthYear: d.person.birthYear,
        deceasedBirthMonth: d.person.birthMonth,
        deceasedClaimMonth: ownFrom[deceasedIdx],
        deathMonth: d.death as MonthIndex,
        survivorBirthYear: s.person.birthYear,
        survivorBirthMonth: s.person.birthMonth,
        survivorStartMonth: survivorBegin,
      }).amount;
    }

    let bal = 0;
    for (let y = 0; y < yearCount; y++) {
      const year = asOf.year + y;
      const c = cola[y];
      for (let i = 0; i < n; i++) {
        const ownMonth = Math.max(year * 12, ownFrom[i]);
        const ownBase =
          ownMonth <= year * 12 + 11 ? members[i].pia * ownFactorAt(members[i].person, ownFrom[i], ownMonth) : 0;
        ownVal[i] = ownBase * c;
        // Own DRCs (above PIA) come off the spousal top-up (POMS RS 00615.694); same rule as spousalAmount.
        spousalVal[i] = Math.max(0, spousalBase[i] - Math.max(0, ownBase - members[i].pia)) * c;
      }
      for (let k = 0; k < 12; k++) {
        const month = year * 12 + k;
        if (month < start) continue;
        let out = 0;
        for (let i = 0; i < n; i++) {
          const death = members[i].death;
          if (death !== null && month >= death) {
            out += 0;
            continue;
          }
          let own = month >= ownFrom[i] ? ownVal[i] : 0;
          let spousal = month >= spousalFrom[i] ? spousalVal[i] : 0;
          let survivor = 0;
          if (i === sIdx && survivorWindow !== null && month >= survivorFrom && month <= survivorLast) {
            spousal = 0;
            if (month >= survivorBegin) {
              const amount = survivorAmount * c;
              if (paidBenefit(own, amount) > own) {
                own = 0;
                survivor = amount;
              }
            }
          }
          out += own + spousal + survivor;
        }
        bal = bal * g + out;
      }
    }
    return bal;
  };
}
