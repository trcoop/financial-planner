import type { CoreInputValues } from '../ui/components/CoreInputsForm/CoreInputsForm'
import type { AdvancedAssumptionValues } from '../ui/components/AdvancedAssumptionsForm/AdvancedAssumptionsForm'

/** Bumped only on a genuinely breaking schema change (new/removed/retyped field with no safe
 * default). Same-version missing-field drift is handled by the partial-merge in
 * `loadAssumptions` (ERD §5.2), not by bumping this. No v2 migration function exists yet — out
 * of scope per the PRD; this constant exists so a future breaking change has one place to
 * change. */
export const STORAGE_KEY = 'financial-planner:v1'

/** The exact shape written to `localStorage` under {@link STORAGE_KEY}. */
export interface PersistedAssumptions {
  core: CoreInputValues
  advanced: AdvancedAssumptionValues
}
