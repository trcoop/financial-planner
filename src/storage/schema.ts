import type { CoreInputValues } from '../ui/components/CoreInputsForm/CoreInputsForm'
import type { AdvancedAssumptionValues } from '../ui/components/AdvancedAssumptionsForm/AdvancedAssumptionsForm'
import type { Person } from '../ui/components/PeopleTab/Person'
import type { Account } from '../ui/components/AccountsTab/Account'

/** Bumped only on a genuinely breaking schema change (new/removed/retyped field with no safe
 * default). Same-version missing-field drift is handled by the partial-merge in
 * `loadAssumptions` (ERD §5.2), not by bumping this. No v2 migration function exists yet — out
 * of scope per the PRD; this constant exists so a future breaking change has one place to
 * change.
 *
 * FIN-116 adds `people` to `PersistedAssumptions` below without bumping this — that's a new,
 * additive field with a safe seeded default (`seedPeople`, `Person.ts`) for records that predate
 * it, same "same-version missing-field drift" category as any other field addition, not a
 * breaking change. */
export const STORAGE_KEY = 'financial-planner:v1'

/** The exact shape written to `localStorage` under {@link STORAGE_KEY}. */
export interface PersistedAssumptions {
  core: CoreInputValues
  advanced: AdvancedAssumptionValues
  /** FIN-116: replaces the retired `core.hasSpouse`/`core.spouseAge` fields. Absent on any
   * record persisted before this ticket — `loadAssumptions` seeds it via `seedPeople`. */
  people: Person[]
  /** FIN-117: additive field, same category as `people` above. Absent on any record persisted
   * before this ticket — `loadAssumptions` seeds it via `seedAccounts` (empty array, since
   * there's no default account to seed, unlike the pre-loaded primary Person). */
  accounts: Account[]
}
