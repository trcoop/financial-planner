/**
 * Pinned type contracts for the federal tax engine (ERD §4).
 *
 * These are the literal contracts every work package builds against. They are complete, not
 * indicative. The doc comments carrying resolved decisions are part of the contract.
 *
 * Units and numeric conventions, repo-wide for this module: all dollar figures in and out are
 * whole dollars as plain JS numbers — never cents, never a decimal or bigint type. All rates
 * (bracket rates, effective rates, marginal rates, FICA rates, indexing rates) are decimals:
 * `0.22`, not `22`. This needs stating because `src/engine/` genuinely carries both conventions:
 * `errors.ts:58-62` documents `annualContributionRate` as "outside [0, 1]" (decimal), while Monte
 * Carlo's allocation fields are percent-valued and sum to 100 (`ALLOCATION_SUM_INVALID`). Percent
 * formatting for band labels and rate annotations happens in the UI, not in engine output.
 */

// ---------------------------------------------------------------------------------------------
// 4.1 Input
// ---------------------------------------------------------------------------------------------

/** All four are carried in `tables.ts` as data and accepted by the public API. No v1 product
 * path emits 'mfs' or 'hoh' — the caller derives 'mfj' if the plan has a spouse and 'single'
 * otherwise — but a test, a Ladle story, or the next caller can reach them, which is why the
 * MFS/HOH tables are verified rather than merely annotated (PRD, review round 3). */
export type FilingStatus = 'single' | 'mfj' | 'mfs' | 'hoh';

/** One adult on the return. Per-person, not a household scalar, and this is forced rather than
 * chosen: the Social Security wage base is per WORKER (two spouses each earning $150,000 pay SS
 * tax on $300,000, not on $184,500) while the Additional Medicare Tax threshold is per RETURN
 * against combined wages. A household scalar understates SS tax by up to a full wage base on any
 * dual-earner joint return. Per-person `age` is required for the same reason: the age-65
 * standard-deduction addition and the OBBBA senior bonus are both per qualifying taxpayer. */
export interface TaxPayer {
  /**
   * This person's FICA-able wages. Whole nominal dollars for `FederalTaxInput.year`.
   *
   * A FICA-ONLY SUBSET TAG of `ordinaryIncome`, never an additional income amount: the engine
   * validates that the sum of per-person `earnedIncome` does not exceed `ordinaryIncome`, and
   * never folds it into the ordinary ladder a second time. The subset framing is deliberate over
   * a disjoint earned/unearned pair — under the disjoint reading, an implementer who forgets to
   * add earned income into the ordinary ladder produces silently tax-free wages; under the subset
   * reading that mistake is structurally impossible.
   */
  earnedIncome: number;
  /**
   * Age at the end of the tax year. `age >= 65` qualifies for the age-65 additional standard
   * deduction and for the senior bonus.
   *
   * v1 does NOT model the statutory rule that a taxpayer turning 65 on January 1 qualifies for
   * the PRIOR year. Stated here rather than left to be discovered.
   */
  age: number;
}

/**
 * Projection rates for years beyond the last year `tables.ts` carries published actuals for.
 * Caller-supplied because the engine holds no opinion about future inflation (PRD, Inflation
 * indexing). Both are annual DECIMAL growth rates: 0.025, not 2.5.
 *
 * These are ignored entirely for years covered by a published Rev. Proc. — those years read
 * published actuals and are exactly §1(f)(3)-correct with no computation. Only years past the
 * last published year compound forward. Required, not optional, precisely so that no default
 * smuggles an engine opinion in through the back door.
 */
export interface IndexingRates {
  /** Applied to every field tagged `chained-cpi-u`. */
  chainedCpiU: number;
  /** Applied to every field tagged `average-wage-index` — currently only the SS wage base. */
  averageWageIndex: number;
}

export interface FederalTaxInput {
  /**
   * CALENDAR year. Integer, 2026–2125 inclusive. Not a plan offset — the existing
   * `TaxContext.year` is a 0-indexed plan offset and cannot be handed to this function without
   * conversion (that conversion is the future wiring project's job, not this module's).
   *
   * Out of range throws rather than clamping, and a non-integer throws rather than rounding
   * (§7). Below 2026 there is no published table and silently clamping to the nearest one is
   * exactly the quiet wrongness this engine exists to avoid; above 2125 indexing forward
   * indefinitely just moves the absurdity out of sight. 2125 is a deliberate arbitrary-but-stated
   * bound; moving it later is a one-line data change.
   */
  year: number;
  /** Derived by the CALLER (joint if the plan has a spouse, single otherwise) and passed in
   * explicitly. The engine stays pure and has no access to plan shape, and widening the
   * derivation later is a caller change with no engine change. Validated against
   * `people.length` — they cannot silently disagree (§7). */
  filingStatus: FilingStatus;
  /**
   * The household's FULL ordinary total — earned and unearned together. This is what the
   * ordinary ladder taxes.
   *
   * Ordinary is NOT the same as earned: traditional-IRA/401(k) withdrawals, interest,
   * non-qualified dividends and pension income are all ordinary but are not FICA-able. When
   * taxable Social Security eventually lands it enters here and is simply not tagged as earned,
   * which is the correct treatment.
   *
   * NOMINAL dollars for `year`, never today's dollars. The engine indexes thresholds forward in
   * nominal terms, so a caller passing a today's-dollar figure against a 2050 table understates
   * tax badly. `toTodaysDollarRows` exists on the engine barrel, so this is a live footgun;
   * inflating today's-dollar figures is the caller's job.
   */
  ordinaryIncome: number;
  /** The household's long-term-capital-gain / qualified-dividend total. Nominal dollars for
   * `year`. Taxed on its own ladder, stacked above ordinary income (§5.3). */
  preferentialIncome: number;
  /** One entry per adult on the return. Exactly 2 for 'mfj'; exactly 1 for 'single', 'mfs' and
   * 'hoh'. An empty array throws. */
  people: readonly TaxPayer[];
  indexing: IndexingRates;
}

// ---------------------------------------------------------------------------------------------
// 4.2 Result
// ---------------------------------------------------------------------------------------------

/** One band of a ladder as authored in `tables.ts`. Half-open `[lowerBound, upperBound)`. */
export interface LadderBand {
  rate: number;
  lowerBound: number;
  /** `Infinity` for the top band. */
  upperBound: number;
}
export type Ladder = readonly LadderBand[];

/** One band of a ladder as APPLIED to this taxpayer, for chart consumption. */
export interface BracketOccupancy {
  rate: number;
  /** The bound actually applied to this taxpayer, after any ladder shift. The lowest band's
   * floor is pinned structurally to `0` (`index === 0 ? 0 : …`); every other bound is clamped
   * at `0`. Not a blanket clamp — see §5.3 step 4 and §5.4.
   * For `ordinaryBrackets` these equal the statutory bounds (the ordinary ladder is never
   * shifted — see the doc comment on `ordinaryBrackets`). */
  lowerBound: number;
  /** `Infinity` for the top band. */
  upperBound: number;
  /** `max(0, min(income, upperBound) - lowerBound)`. Zero for unoccupied bands, which are
   * still present in the array — the empty bands above the marginal one are exactly the
   * visual that makes conversion headroom legible. */
  incomeInThisBracket: number;
  /** `incomeInThisBracket * rate`, UNROUNDED by design. Reconciles with the rounded
   * `ordinaryTax`/`preferentialTax` only within $1 (§6.2.2; asserted by P7/P8). */
  taxFromThisBracket: number;
}

/**
 * The deduction, decomposed. The senior bonus is a SIBLING of the standard deduction, not a
 * component of it: per OBBBA §70103 it is a BELOW-THE-LINE deduction reported on Schedule 1-A,
 * available to itemizers and standard-deduction takers alike. In v1 the arithmetic total is
 * identical, but the structure matters in three ways — the waterfall must label them as separate
 * segments (teaching the wrong structure is precisely what that chart must not do), the bonus
 * survives itemizing while the standard deduction does not, and the bonus phases out on MAGI
 * while the standard deduction does not.
 */
export interface DeductionBreakdown {
  /** Base standard deduction for this filing status and year. */
  base: number;
  /** Age-65 additional standard deduction × the number of people with `age >= 65`. */
  ageAddition: number;
  /** `base + ageAddition`. */
  standardDeduction: number;
  /** OBBBA senior bonus, summed over qualifying taxpayers after each one's own independent
   * phase-out. `0` outside 2025–2028, and `0` for 'mfs' at any MAGI. */
  seniorBonusDeduction: number;
  /** `standardDeduction + seniorBonusDeduction`. The figure the waterfall subtracts and the
   * figure the ladder shift is computed against. */
  total: number;
}

/** The three components below sum to `total` as EXACT integer equality (P13). */
export interface FicaBreakdown {
  /** 6.2% of each person's `earnedIncome`, capped at that year's wage base SEPARATELY PER
   * PERSON, then summed. */
  socialSecurity: number;
  /** 1.45% of each person's `earnedIncome`, uncapped, summed. */
  medicare: number;
  /** 0.9% of COMBINED household earned income above the per-return statutory threshold
   * ($200,000 single / $250,000 MFJ / $125,000 MFS / $200,000 HOH — all frozen, unindexed).
   * Exactly `0` for a household below the threshold; never the rounding-remainder recipient
   * (§5.7). */
  additionalMedicare: number;
  /** The three components above sum to `total` as EXACT integer equality (P13). */
  total: number;
}

export interface FederalTaxResult {
  /** Echoed so a chart can label itself ("Single filer, 2026") without the story passing them
   * alongside the result — consistent with the rule that a chart never imports `tables.ts`. */
  year: number;
  filingStatus: FilingStatus;

  grossOrdinaryIncome: number;
  grossPreferentialIncome: number;
  /** Modified AGI, the base the senior bonus phases out against. In v1, MAGI == AGI ==
   * `grossOrdinaryIncome + grossPreferentialIncome`, because every add-back that would separate
   * them (taxable Social Security, tax-exempt interest, foreign-income exclusions) is a stated
   * Non-Goal. DERIVED, never an input. There is no circularity: the bonus is below-the-line, so
   * it does not reduce the MAGI it phases out against. When any add-back lands, this stops
   * being a sum and becomes a real derivation with its own function. */
  magi: number;

  deduction: DeductionBreakdown;

  /** `max(0, grossOrdinaryIncome - deduction.total)`. */
  taxableOrdinaryIncome: number;
  /**
   * The TRUE taxable preferential figure:
   * `max(0, ordinaryIncome + preferentialIncome - deduction.total) - taxableOrdinaryIncome`.
   *
   * NOTE, and this is the field most likely to be misread: this does NOT equal the sum of
   * `preferentialBrackets[].incomeInThisBracket`. Those entries report GROSS preferential income
   * against SHIFTED bounds and therefore sum to `grossPreferentialIncome`; the difference between
   * the two is exactly the portion of the deduction that ordinary income did not consume. That is
   * an inherent property of the shifted-ladder formulation, which this design chose deliberately
   * because it is the only formulation in which the negative shift is visible. The two charts are
   * not disagreeing.
   */
  taxablePreferentialIncome: number;
  /** `taxableOrdinaryIncome + taxablePreferentialIncome`, matching Form 1040's taxable income,
   * and the waterfall's "taxable income" segment. */
  taxableIncome: number;

  /**
   * Every band of this year and status's ordinary ladder, including unoccupied ones, reporting
   * `taxableOrdinaryIncome` against STATUTORY, UNSHIFTED bounds. Therefore
   * `sum(incomeInThisBracket) === taxableOrdinaryIncome`.
   *
   * The ordinary ladder is never shifted: the deduction is applied to INCOME, not to the ladder.
   * (The PRD's Information Architecture prose about "shifting ordinary bracket ends up" was
   * superseded by the five-step formula — see §5.3. That prose applies to the preferential
   * ladder only.)
   */
  ordinaryBrackets: readonly BracketOccupancy[];
  /**
   * Every band of this year and status's preferential ladder, including unoccupied ones,
   * reporting GROSS preferential income against SHIFTED bounds. Therefore
   * `sum(incomeInThisBracket) === grossPreferentialIncome`, NOT `taxablePreferentialIncome`.
   * See the note on `taxablePreferentialIncome`.
   */
  preferentialBrackets: readonly BracketOccupancy[];

  /** Rounded to whole dollars; `ordinaryTax + preferentialTax === taxBeforeCredits` exactly
   * (§5.7). */
  ordinaryTax: number;
  preferentialTax: number;
  taxBeforeCredits: number;
  /** Always `0` in v1. Typed `number`, not the literal `0`, so a real credit later is not a
   * type change. Nothing computes it. */
  credits: number;
  /** `taxBeforeCredits - credits`. EXCLUDES FICA — FICA is never folded into income tax. */
  taxOwed: number;

  fica: FicaBreakdown;

  /**
   * `taxOwed / (grossOrdinaryIncome + grossPreferentialIncome)` — INCOME TAX ONLY, excluding
   * FICA, so that it shares a basis with `effectiveMarginalRate`. `0`, never `NaN`, when gross
   * income is zero.
   */
  effectiveRate: number;
  /**
   * `(taxOwed + fica.total) / (grossOrdinaryIncome + grossPreferentialIncome)` — the total-burden
   * picture. Explicitly NOT subject to the "effective rate never exceeds marginal rate" property:
   * a single 2026 filer with $30,000 of earned income owes $1,420 of income tax ($12,400 at 10%
   * plus $1,500 at 12%, standard deduction $16,100) plus $2,295 of FICA — $3,715 total, a 12.4%
   * burden against a 12% bracket rate. `0`, never `NaN`, at zero income.
   */
  effectiveRateIncludingFica: number;

  /**
   * The STATUTORY rate of the ordinary band that the next ordinary dollar would fall into: the
   * unique band with `lowerBound <= taxableOrdinaryIncome < upperBound`. This is what the bracket
   * ladder's marker renders.
   *
   * With ZERO ordinary income this reports the rate the FIRST ordinary dollar would face (10% in
   * every year and status currently in the tables) — which falls out of the lookup rule above
   * rather than being a special case, but is surprising enough to be written down.
   *
   * There is no field named `marginalRate`; the name is retired because it was carrying three
   * incompatible meanings.
   */
  ordinaryBracketRate: number;
  /**
   * The ACTUAL change in total income tax from one additional dollar of ordinary income, by
   * finite difference (§5.6). Includes the senior-bonus phase-out bubble (`bracketRate × 1.06`
   * for one qualifying taxpayer, `× 1.12` for an MFJ return with two) and the preferential
   * pushback (one more ordinary dollar can push a preferential dollar from the 0% band into 15%,
   * so the true cost is 10% + 15% = 25% while `ordinaryBracketRate` reads 10%).
   *
   * This is what a future Roth-conversion or withdrawal-sequencing analysis optimises against.
   * It is deliberately NOT monotonic in income — see §6.2's P4, the explicit non-monotonicity
   * property (a pair straddling the senior-bonus phase-out end, where this rate FALLS as
   * income rises).
   * `0`, never `NaN`, at zero income.
   */
  effectiveMarginalRate: number;
}

// ---------------------------------------------------------------------------------------------
// 4.3 Table and indexing types
// ---------------------------------------------------------------------------------------------

/** How a threshold moves between published years. Six tags, four distinct behaviors. */
export type IndexingPolicy =
  | {
      kind: 'chained-cpi-u';
      /** §1(f)(3) uses calendar year 2016 as the unchained-CPI denominator; §1(j)(5) substitutes
       * 2017 for the LTCG thresholds. Under this design's compound-off-the-last-published-actual
       * approach the base year is BEHAVIORALLY IRRELEVANT — it is retained as documentation of
       * statutory authority, not as behavior. Getting the two bases wrong drifts LTCG thresholds
       * relative to ordinary brackets only if published actuals are ever replaced by computed
       * values, which this design never does. */
      baseYear: 2016 | 2017;
      rounding: RoundingRule;
    }
  | {
      kind: 'average-wage-index';
      /** Round to NEAREST $300 — the opposite direction from §1(f)(7) truncation. */
      rounding: { kind: 'nearest'; increment: 300 };
      /** The AWI carries a two-year lag (vs. the ~16-month lag on chained CPI-U). Documentation
       * of statutory provenance ONLY: it does not change the compounding exponent, because the
       * published actual this compounds off already embeds its own lag. See §5.5. */
      lagYears: 2;
    }
  /** Statutorily frozen and unindexed (the Additional Medicare Tax threshold). Never compounds. */
  | { kind: 'frozen' }
  /** A rate, not a dollar threshold (6.2%, 1.45%, 0.9%, the 6% senior-bonus clawback). Never
   * compounds. */
  | { kind: 'statutory-rate' }
  /** Exists only through `lastApplicableYear`, then is zero. The OBBBA senior bonus. */
  | { kind: 'sunset'; lastApplicableYear: number; rounding?: RoundingRule };

/** §1(f)(7) truncates DOWN to the next lowest $50, with $25 substituted for MFS — EXCEPT for
 * the §63(c)(4) standard deduction and §151(d)(4)(A), where MFS truncates to $50 like every
 * other status. Because the increment therefore varies by field AND status, it is authored
 * per entry rather than derived from the status. */
export type RoundingRule =
  | { kind: 'truncate'; increment: 50 | 25 }
  | { kind: 'nearest'; increment: 300 };

/** Per-entry provenance marker. NOTE (§9.1, RESOLVED 2026-09-10): no shipped entry is ever
 * 'unconfirmed' — an unverifiable figure means its filing status is omitted from TAX_TABLES and
 * listed in UNSUPPORTED_FILING_STATUSES, so computeFederalTax throws for that status rather than
 * returning a plausible-looking wrong number. The member is retained deliberately: it is what
 * §6.5's authoring test asserts the ABSENCE of, and it is the correct marker for a figure that is
 * mid-verification during a future Rev. Proc. update, before it either confirms or gets pulled.
 * Do not narrow this union to a single member. */
export type Confidence = 'confirmed' | 'unconfirmed';

/** One indexed dollar figure: its published actuals, its policy, and its provenance. */
export interface IndexedAmount {
  /** Published actuals keyed by calendar year. Must be contiguous from `FIRST_SUPPORTED_YEAR`
   * to the last published year (authoring test, §6.6). */
  published: Readonly<Record<number, number>>;
  policy: IndexingPolicy;
  /** Primary source this figure was verified against, e.g. 'Rev. Proc. 2025-32 §2.01'. */
  source: string;
  confidence: Confidence;
  /** REQUIRED when `confidence !== 'confirmed'`: names exactly what is unverified and against
   * which source it still needs checking. Enforced by the authoring test. */
  unverifiedNote?: string;
}

export interface IndexedLadder {
  published: Readonly<Record<number, Ladder>>;
  policy: IndexingPolicy;
  source: string;
  confidence: Confidence;
  unverifiedNote?: string;
}

export interface SeniorBonusParameters {
  /** Per qualifying taxpayer, before phase-out. `0` for 'mfs' (ineligible regardless of MAGI —
   * encoded explicitly rather than left to fall out of the arithmetic). */
  amountPerQualifyingPerson: number;
  /** MAGI above which the bonus reduces: $75,000 unmarried (single AND hoh — HOH uses the
   * UNMARRIED thresholds), $150,000 mfj. For MFS both this and `phaseOutEnd` are `0` — INERT,
   * not a sourced threshold: `amountPerQualifyingPerson: 0` makes MFS ineligible at any MAGI, so
   * no threshold is ever consulted. `0` is chosen over a plausible-looking $125,000 (half of MFJ,
   * mirroring the MFS Additional Medicare threshold) precisely so a future reader cannot mistake
   * it for a real figure. §6.5's identity `phaseOutEnd === phaseOutStart + amount / rate` holds
   * trivially. Added engineering review round 1, 2026-09-09 — previously unpinned, which would
   * have had WP-C invent a value and WP-D's MFS-ineligibility test assert against a different one. */
  phaseOutStart: number;
  /** MAGI at which it reaches zero: $175,000 unmarried, $250,000 mfj. Derivable as
   * `phaseOutStart + amountPerQualifyingPerson / phaseOutRate`; carried explicitly and pinned
   * against that identity by the authoring test. `0` for MFS — see `phaseOutStart`. */
  phaseOutEnd: number;
  /** 0.06 — reduced by 6% of MAGI above `phaseOutStart`, PER QUALIFYING TAXPAYER. */
  phaseOutRate: number;
  /** 2028. NOT 2029: ProjectionLab's table encodes `expiration: 2029` as an EXCLUSIVE bound;
   * lifting that literal grants a free extra year of deduction. */
  lastApplicableYear: number;
  /** 2025 — the bonus's first year. Below `FIRST_SUPPORTED_YEAR`, so unreachable through
   * `computeFederalTax`; asserted directly against `seniorBonusAppliesInYear`. */
  firstApplicableYear: number;
}

export interface FicaParameters {
  socialSecurityRate: number; // 0.062, statutory-rate
  socialSecurityWageBase: number; // per WORKER, average-wage-index
  medicareRate: number; // 0.0145, statutory-rate
  additionalMedicareRate: number; // 0.009, statutory-rate
  additionalMedicareThreshold: number; // per RETURN, frozen
}

/** Everything `computeFederalTax` needs from `tables.ts` for one (year, filingStatus) pair, with
 * every indexed figure already resolved to a number. */
export interface ResolvedYearTables {
  year: number;
  filingStatus: FilingStatus;
  ordinaryLadder: Ladder;
  /** For 'mfs' this may be absent when the MFS preferential thresholds could not be sourced from
   * a primary document — see the typed-throw fallback in §7. Never a guessed half-of-MFJ ladder. */
  preferentialLadder: Ladder | undefined;
  standardDeductionBase: number;
  ageAdditionPerQualifyingPerson: number;
  seniorBonus: SeniorBonusParameters;
  fica: FicaParameters;
}
