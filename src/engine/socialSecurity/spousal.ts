/**
 * WP-C: spousal top-up and the own + spousal series (PRD Phase 1 spousal bullets, E6, E8, E9; ERD §4,
 * §12.19.1, §12.19.8, §12.25.1). Pure; no rounding anywhere (§12.3). Component amounts are BASE
 * dollars (pre-COLA); `computeOwnAndSpousal` applies `(1+cola)^(Y - asOf.year)` once per amount.
 */
import { birthMonthIndex, calculatorStartMonth } from '../age';
import { InvalidProjectionInputError } from '../errors';
import { collectingPia, fraMonths, ownFactorAt } from './benefit';
import { EARLIEST_CLAIM_OFFSET_MONTHS, LATEST_CLAIM_OFFSET_MONTHS, MAX_COLA_RATE, MAX_GROWTH_RATE } from './constants';
import type { MonthIndex, SsAnnualRow, SsInputs, SsMonth, SsPerson, SsResult, SsStartKind } from './types';

function requireFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new InvalidProjectionInputError('NON_FINITE_INPUT', `${name} must be a finite number (got ${value})`);
  }
}

function requireBenefit(value: number, name: string): void {
  requireFinite(value, name);
  if (value < 0) {
    throw new InvalidProjectionInputError('SS_NEGATIVE_BENEFIT', `${name} must be >= 0 (got ${value})`);
  }
}

/**
 * BASE $/month spousal top-up for a start in month `spousalStart` (PRD E6): `max(0, 0.5 x otherPia -
 * ownPia)` reduced 25/36 % per month for the first 36 months before the claimant's own FRA and 5/12 %
 * per month beyond, measured from `spousalStart` (the later of both filing months), not from the
 * claimant's own claim. No reduction at or after FRA and no delayed credits (nothing to gain from
 * waiting). `ownFraMonths` is the calendar month index of the claimant's own FRA month
 * (`birthMonthIndex + fraMonths(birthYear)`), since `spousalStart` is calendar too. No January rule.
 */
export function spousalAmount(a: {
  ownPia: number;
  otherPia: number;
  ownFraMonths: number;
  spousalStart: MonthIndex;
}): number {
  requireBenefit(a.ownPia, 'ownPia');
  requireBenefit(a.otherPia, 'otherPia');
  requireFinite(a.ownFraMonths, 'ownFraMonths');
  requireFinite(a.spousalStart, 'spousalStart');
  const excess = Math.max(0, 0.5 * a.otherPia - a.ownPia);
  const monthsEarly = Math.max(0, a.ownFraMonths - a.spousalStart);
  const reductionPercent = monthsEarly <= 36 ? (monthsEarly * 25) / 36 : 25 + ((monthsEarly - 36) * 5) / 12;
  return excess * (1 - reductionPercent / 100);
}

/** One validated household member: PIA (derived from the check for a collecting person) and own start. */
interface Member {
  person: SsPerson;
  pia: number;
  birthIdx: MonthIndex;
  ownStart: MonthIndex;
}

function validateRates(inputs: Omit<SsInputs, 'deathAgeYears'>): void {
  const { colaRate, growthRate, endYear } = inputs;
  requireFinite(colaRate, 'colaRate');
  if (colaRate < 0 || colaRate > MAX_COLA_RATE) {
    throw new InvalidProjectionInputError('SS_INVALID_COLA', `colaRate must be within 0..${MAX_COLA_RATE} (got ${colaRate})`);
  }
  if (growthRate !== null) {
    requireFinite(growthRate, 'growthRate');
    if (growthRate < 0 || growthRate > MAX_GROWTH_RATE) {
      throw new InvalidProjectionInputError(
        'SS_INVALID_GROWTH_RATE',
        `growthRate must be null or within 0..${MAX_GROWTH_RATE} (got ${growthRate})`,
      );
    }
  }
  requireFinite(endYear, 'endYear');
  if (!Number.isInteger(endYear) || endYear < inputs.asOf.year) {
    throw new InvalidProjectionInputError(
      'SS_INVALID_AS_OF',
      `endYear must be an integer year >= asOf.year (got ${endYear})`,
    );
  }
}

/** Validates person `i` against its `claimMonth` entry and resolves PIA and own start month. */
function resolveMember(inputs: Omit<SsInputs, 'deathAgeYears'>, i: number): Member {
  const { asOf } = inputs;
  const person = inputs.people[i];
  const claim = inputs.claimMonth[i];
  const birthIdx = birthMonthIndex(person.birthYear, person.birthMonth);
  fraMonths(person.birthYear);
  if (person.benefit.kind === 'collecting') {
    if (claim !== null && claim !== undefined) {
      throw new InvalidProjectionInputError(
        'SS_INVALID_ALREADY_COLLECTING',
        `claimMonth[${i}] must be null for a collecting person (their start is sinceMonth)`,
      );
    }
    return { person, pia: collectingPia(person, asOf), birthIdx, ownStart: person.benefit.sinceMonth };
  }
  requireBenefit(person.benefit.pia, 'pia');
  if (claim === null || claim === undefined) {
    throw new InvalidProjectionInputError(
      'SS_INVALID_ALREADY_COLLECTING',
      `claimMonth[${i}] is required for a person whose benefit.kind is "pia"`,
    );
  }
  requireFinite(claim, `claimMonth[${i}]`);
  const claimAge = claim - birthIdx;
  if (claimAge < EARLIEST_CLAIM_OFFSET_MONTHS) {
    throw new InvalidProjectionInputError('SS_CLAIM_BEFORE_ELIGIBLE', `claimMonth[${i}] is before 62y1m`);
  }
  if (claimAge > LATEST_CLAIM_OFFSET_MONTHS) {
    throw new InvalidProjectionInputError('SS_CLAIM_AFTER_70', `claimMonth[${i}] is after 70y0m`);
  }
  if (claim <= calculatorStartMonth(asOf)) {
    throw new InvalidProjectionInputError('SS_CLAIM_IN_PAST', `claimMonth[${i}] must be after the asOf month`);
  }
  return { person, pia: person.benefit.pia, birthIdx, ownStart: claim };
}

/**
 * Own + spousal series for the plan and the calculator (survivor always 0, `deathMonths` all null;
 * ERD §12.25.1). Own = `pia x ownFactorAt` (January rule), spousal = `spousalAmount` from the later of
 * both people's own start months (`sinceMonth` for a collecting person, §12.19.8); each is then
 * multiplied by `(1+cola)^(year - asOf.year)`. Covers January of `asOf.year` through December of
 * `endYear`; months before a start are 0, so a collecting person's year 0 is the full calendar year
 * (§12.19.1). `starts` lists own/spousal starts that fall inside that window (a spousal start only
 * when the top-up is positive), ordered by month, then own before spousal, then person.
 */
export function computeOwnAndSpousal(inputs: Omit<SsInputs, 'deathAgeYears'>): SsResult {
  const { asOf, people, claimMonth } = inputs;
  calculatorStartMonth(asOf);
  if (people.length < 1 || people.length > 2) {
    throw new InvalidProjectionInputError('SS_SPOUSAL_INPUT_ON_SINGLE', 'people must hold one or two persons');
  }
  if (claimMonth.length > people.length) {
    throw new InvalidProjectionInputError(
      'SS_SPOUSAL_INPUT_ON_SINGLE',
      'claimMonth has more entries than the household has people',
    );
  }
  validateRates(inputs);
  const members: Member[] = people.map((_, i) => resolveMember(inputs, i));

  const firstMonth = asOf.year * 12;
  const lastMonth = inputs.endYear * 12 + 11;
  const yearCount = inputs.endYear - asOf.year + 1;
  const starts: SsResult['starts'] = [];
  const base: { own: number; spousal: number; ownFrom: MonthIndex; spousalFrom: MonthIndex }[] = [];

  members.forEach((m, i) => {
    let spousal = 0;
    let spousalFrom = Number.POSITIVE_INFINITY;
    if (members.length === 2) {
      const other = members[1 - i];
      spousalFrom = Math.max(m.ownStart, other.ownStart);
      spousal = spousalAmount({
        ownPia: m.pia,
        otherPia: other.pia,
        ownFraMonths: m.birthIdx + fraMonths(m.person.birthYear),
        spousalStart: spousalFrom,
      });
    }
    base.push({ own: m.pia, spousal, ownFrom: m.ownStart, spousalFrom });
    if (m.ownStart >= firstMonth && m.ownStart <= lastMonth) starts.push({ personIndex: i, kind: 'own', month: m.ownStart });
    if (spousal > 0 && spousalFrom >= firstMonth && spousalFrom <= lastMonth) {
      starts.push({ personIndex: i, kind: 'spousal', month: spousalFrom });
    }
  });
  const kindOrder: Record<SsStartKind, number> = { own: 0, spousal: 1, survivor: 2 };
  starts.sort((a, b) => a.month - b.month || kindOrder[a.kind] - kindOrder[b.kind] || a.personIndex - b.personIndex);

  const series: SsMonth[][] = members.map(() => []);
  const annual: SsAnnualRow[] = [];
  for (let y = 0; y < yearCount; y++) {
    const year = asOf.year + y;
    const cola = (1 + inputs.colaRate) ** y;
    const perPerson = members.map((m, i) => {
      const b = base[i];
      // The own factor only changes in January (or at the claim), so one lookup per year suffices.
      const ownMonth = Math.max(year * 12, b.ownFrom);
      const ownBase = ownMonth <= year * 12 + 11 ? b.own * ownFactorAt(m.person, b.ownFrom, ownMonth) : 0;
      let own = 0;
      let spousal = 0;
      for (let k = 0; k < 12; k++) {
        const month = year * 12 + k;
        const o = month >= b.ownFrom ? ownBase * cola : 0;
        const s = month >= b.spousalFrom ? b.spousal * cola : 0;
        series[i].push({ own: o, spousal: s, survivor: 0 });
        own += o;
        spousal += s;
      }
      return { own, spousal, survivor: 0, total: own + spousal };
    });
    annual.push({ year, perPerson, household: perPerson.reduce((sum, p) => sum + p.total, 0) });
  }

  return { firstMonth, lastMonth, series, annual, starts, deathMonths: members.map(() => null) };
}
