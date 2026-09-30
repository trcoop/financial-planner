# Federal tax reference fixtures (FIN-159)

Frozen regression data for `../federalTax.reference.test.ts`, which runs 250 scenarios through
`computeFederalTax` and compares against PolicyEngine-US. Purpose: a bad table entry in
`tables.ts` (e.g. FIN-158's stale age-65 addition) must fail a test the next time tables change.

## Files

- `scenarios.json` - 250 scenarios: `id`, `category`, `description`, `neutral` (tool-agnostic
  input) and `engineInput` (a `FederalTaxInput`). Categories: `bracket_wage`, `bracket_nonwage`,
  `preferential`, `age65`, `fica`, `typical`. Filing statuses: single, MFJ, HOH. **Static data,
  never regenerated from `tables.ts` at test time.**
- `policyengine-2026.json` - provenance header plus `expected[id]`: `incomeTax`,
  `incomeTaxBeforeCredits`, `alternativeMinimumTax`, `socialSecurity`, `medicare`,
  `additionalMedicare`, `ficaTotal` (dollars, cents precision).
- `run_py.py`, `make_expected.py`, `generateScenarios.ts` - regeneration tooling. Not run in CI,
  not imported by the app or tests. `generateScenarios.ts` is type-checked by `tsc -b` only.

## How the reference was produced

Run 2026-09-29 with policyengine-us 2.18.0, policyengine-core 3.32.10, Python 3.14.

Input mapping: `wages` -> `employment_income` per person; `otherOrdinaryIncome` ->
`taxable_interest_income` (person 0); `ltcgQualifiedDividends` -> `long_term_capital_gains`
(person 0); state TX; no dependents; `single`=SINGLE, `mfj`=JOINT, `hoh`=HEAD_OF_HOUSEHOLD.

- income tax = `income_tax_before_credits` minus `alternative_minimum_tax`
- FICA = `employee_social_security_tax` + `employee_medicare_tax` + `additional_medicare_tax`

The test asserts `|engine - reference| <= $1` on income tax (`taxOwed`), FICA total, and each of
the three FICA components. PolicyEngine does not round to whole dollars; the engine does, so
deltas up to $0.50 are expected.

## Caveats

- AMT is subtracted from PolicyEngine's before-credits figure (6 HOH preferential 15%->20% (ord12/ord24 edges)
  scenarios trigger AMT there). The engine does not model AMT.
- NIIT is excluded (separate PolicyEngine variable `net_investment_income_tax`).
- The engine uses the IRS rate schedule, not the IRS Tax Table (which differs by up to ~$6 under
  $100k taxable income). PolicyEngine also uses the schedule, so they agree.
- ProjectionLab is NOT part of the fixture (no HOH table; applies a single SS wage base to
  combined joint wages). It is a manual methodology oracle only.
- No MFS scenarios: the engine refuses MFS preferential income by design.
- Tax year 2026 only.

## Regenerating for a new tax year

1. Add the new year's tables to `tables.ts` and verify them against the IRS Rev. Proc. first.
2. Generate scenarios (frozen once checked in; `generateScenarios.ts` reads bracket edges from
   `tables.ts`, so review the output against the published tables, do not trust it blindly):
   `npx --yes tsx src/engine/tax/referenceFixtures/generateScenarios.ts <dir>/scenarios.json`  (tsx is not a repo dependency; npx fetches it)
   (update the `2026` year literals in the script first).
3. Set up Python outside the repo:
   `python3 -m venv venv && venv/bin/pip install policyengine-us==<pinned version>`
4. Copy `run_py.py` and the new `scenarios.json` together (the script reads `scenarios.json` from
   its own directory and writes `py_results.json`), set `Y` to the new year, then
   `venv/bin/python run_py.py`.
5. `python make_expected.py` prints the `expected` map; paste it into a new
   `policyengine-<year>.json` with an updated provenance block (versions, date, caveats).
6. Point the test at the new files. If any scenario disagrees by more than $1, investigate as a
   possible table bug (or PolicyEngine parameter lag) before touching the tolerance.
7. Do not commit `py_results.json` or the venv.
