import type { CoreInputValues } from './types'

export const DEFAULT_CORE_VALUES: CoreInputValues = {
  currentAge: 35,
  // 65 (FIN-64): traditional/Medicare-eligibility retirement age, and paired with the fixed
  // 100 planning horizon end age gives a round 35-year retirement — see
  // AdvancedAssumptionsForm's DEFAULT_ADVANCED_VALUES.withdrawalRatePercent for the
  // withdrawal rate that horizon implies.
  retirementAge: 65,
  initialBalance: 250000,
  currentAnnualIncome: 85000,
  annualContributionRatePercent: 15,
}
