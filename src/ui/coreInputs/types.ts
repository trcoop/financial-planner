export interface CoreInputValues {
  currentAge: number
  retirementAge: number
  initialBalance: number
  currentAnnualIncome: number
  /** Plain percentage (e.g. 15 for 15%), not a 0-1 fraction — matches the field's display. */
  annualContributionRatePercent: number
}

// FIN-116 removed currentAge/retirementAge/currentAnnualIncome from this form (they moved to
// the People tab's primary Person fields, synced in via `syncCoreWithPrimary`). FIN-117's
// bug-fix round removed the remaining two fields (initialBalance/annualContributionRatePercent)
// the same way — they moved to the Accounts tab's primary account, synced in via
// `syncCoreWithPrimaryAccount` (see `AccountsTab/Account.ts`). That emptied this component's
// rendered fields entirely, so there is no longer a `CoreInputsForm` component to mount — only
// the `CoreInputValues` type remains, still needed by `useProjectionState`, `PlanSection`,
// `CORE_FIELD_RANGES`/`isCoreInputValid` (validation.ts), and storage's migration/defaults code.
