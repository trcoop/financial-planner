/**
 * Independent monthly Social Security oracle for FIN-169 tests. Deliberately shares NO code with the
 * engine (no imports from this directory): it is a plain month-by-month loop written straight from the
 * PRD rules, so an engine regression cannot also hide here. Scope: birth year >= 1962 (FRA and survivor
 * FRA both 67y0m = 804 months), COLA 0, growth off, PIA-based people. Money is unrounded dollars.
 */
export interface OraclePerson {
  /** Calendar month index of the birth month (year*12 + month-1). */
  birthIdx: number;
  pia: number;
  /** Calendar month the person's own benefit starts. */
  claim: number;
  /** Calendar month of death (first month NOT paid), or Infinity. */
  death: number;
}

const FRA = 804; // 67y0m in months, every birth year >= 1962

/** Steady (post-January) fraction of PIA for a claim at `age` months. */
export function oracleFactor(age: number): number {
  const d = age - FRA;
  if (d >= 0) return 1 + (d * 2) / 3 / 100;
  const early = -d;
  const pct = early <= 36 ? (early * 5) / 9 : 20 + ((early - 36) * 5) / 12;
  return 1 - pct / 100;
}

/** Own benefit in month `t`, applying the E9 January rule for a delayed (FRA < claim < 70y0m) claim. */
export function oracleOwn(p: OraclePerson, t: number): number {
  if (t < p.claim || t >= p.death) return 0;
  const age = p.claim - p.birthIdx;
  if (age <= FRA || age >= 840 || Math.floor(t / 12) > Math.floor(p.claim / 12)) return p.pia * oracleFactor(age);
  const creditedMonths = Math.max(0, Math.min(age - FRA, Math.floor(p.claim / 12) * 12 - 1 - (p.birthIdx + FRA)));
  return p.pia * (1 + (creditedMonths * 2) / 3 / 100);
}

function oracleSpousal(me: OraclePerson, other: OraclePerson, t: number): number {
  const start = Math.max(me.claim, other.claim);
  if (t < start || t >= me.death || t >= other.death) return 0;
  const excess = Math.max(0, 0.5 * other.pia - me.pia);
  const early = Math.max(0, me.birthIdx + FRA - start);
  const pct = early <= 36 ? (early * 25) / 36 : 25 + ((early - 36) * 5) / 12;
  // POMS RS 00615.694: the spouse's own delayed retirement credits (as actually paid this month, E9
  // January rule included) come off the spousal top-up, so own + spousal never exceeds 0.5 x other PIA.
  const drc = Math.max(0, oracleOwn(me, t) - me.pia);
  return Math.max(0, excess * (1 - pct / 100) - drc);
}

/** Survivor amount fixed at the survivor's start month (E40/E41/E42), or 0 if none yet. */
function oracleSurvivor(me: OraclePerson, gone: OraclePerson, t: number): number {
  const start = Math.max(gone.death, me.birthIdx + 721);
  if (t < start || t >= me.death) return 0;
  const goneAge = gone.claim - gone.birthIdx;
  let base: number;
  let cap = Infinity;
  if (gone.claim <= gone.death) {
    base = goneAge < FRA ? gone.pia : gone.pia * oracleFactor(goneAge);
    if (goneAge < FRA) cap = Math.max(gone.pia * oracleFactor(goneAge), 0.825 * gone.pia);
  } else {
    const credits = Math.max(0, Math.min(gone.death - (gone.birthIdx + FRA), 840 - FRA));
    base = gone.pia * (1 + (credits * 2) / 3 / 100);
  }
  const m = start - me.birthIdx;
  const reduction = m >= FRA ? 0 : (0.285 * (FRA - m)) / (FRA - 720);
  return Math.min(base * (1 - reduction), cap);
}

/** Household payment in calendar month `t` (own + spousal while both live; max(own, survivor) after). */
export function oracleHousehold(people: OraclePerson[], t: number): number {
  let total = 0;
  people.forEach((me, i) => {
    if (t >= me.death) return;
    const own = oracleOwn(me, t);
    if (people.length === 1) {
      total += own;
      return;
    }
    const other = people[1 - i];
    total += t < other.death ? own + oracleSpousal(me, other, t) : Math.max(own, oracleSurvivor(me, other, t));
  });
  return total;
}
