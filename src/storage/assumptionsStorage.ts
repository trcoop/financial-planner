import type { CoreInputValues } from '../ui/components/CoreInputsForm/CoreInputsForm'
import { DEFAULT_CORE_VALUES } from '../ui/components/CoreInputsForm/defaults'
import type { AdvancedAssumptionValues } from '../ui/components/AdvancedAssumptionsForm/AdvancedAssumptionsForm'
import { DEFAULT_ADVANCED_VALUES } from '../ui/components/AdvancedAssumptionsForm/defaults'
import type { Person } from '../ui/components/PeopleTab/Person'
import { seedPeople } from '../ui/components/PeopleTab/Person'
import type { Account } from '../ui/components/AccountsTab/Account'
import { seedAccounts } from '../ui/components/AccountsTab/Account'
import { STORAGE_KEY, type PersistedAssumptions } from './schema'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Reads and validates the persisted plan from `localStorage`, per ERD §5.2. Never throws —
 * any failure (storage inaccessible, missing key, corrupted JSON, wrong shape) resolves to
 * `undefined`, signaling the caller to fall back to defaults.
 *
 * Schema drift (missing or wrong-typed fields on an otherwise-parseable record) is handled by
 * a per-field merge against the current defaults rather than discarding the whole record — see
 * ERD §2.3.
 */
export function loadAssumptions(): PersistedAssumptions | undefined {
  let raw: string | null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    return undefined
  }

  if (raw === null) return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }

  if (!isPlainObject(parsed)) return undefined

  const core: CoreInputValues = {
    ...DEFAULT_CORE_VALUES,
    ...(isPlainObject(parsed.core) ? (parsed.core as Partial<CoreInputValues>) : {}),
  }
  const advanced: AdvancedAssumptionValues = {
    ...DEFAULT_ADVANCED_VALUES,
    ...(isPlainObject(parsed.advanced) ? (parsed.advanced as Partial<AdvancedAssumptionValues>) : {}),
  }

  // FIN-116: `people` is a new field — absent on any record persisted before this ticket (and
  // on any record where it's malformed/empty), in which case `seedPeople` seeds just the
  // primary Person from `core` (never a spouse — see its own doc comment). A pre-FIN-116
  // record's leftover `core.hasSpouse`/`core.spouseAge` (if present in the raw JSON) are never
  // read here — those fields are retired from `CoreInputValues` entirely.
  const people: Person[] = seedPeople(parsed.people, core)

  // FIN-117: `accounts` is a new field, same "absent on pre-this-ticket records" category as
  // `people` above — `seedAccounts` falls back to `[]` rather than trying to seed a default
  // account (there's no equivalent of "pre-load the primary Person" for Accounts).
  const accounts: Account[] = seedAccounts(parsed.accounts)

  return { core, advanced, people, accounts }
}

/**
 * Writes the current plan to `localStorage`, per ERD §5.1. Never throws — quota exceeded,
 * storage disabled (private browsing), or a `SecurityError` (sandboxed iframe) are all
 * swallowed and logged via `console.warn`; callers cannot distinguish "saved" from "silently
 * failed" by design.
 */
export function saveAssumptions(
  core: CoreInputValues,
  advanced: AdvancedAssumptionValues,
  people: Person[],
  accounts: Account[] = [],
): void {
  try {
    const json = JSON.stringify({ core, advanced, people, accounts } satisfies PersistedAssumptions)
    localStorage.setItem(STORAGE_KEY, json)
  } catch (error) {
    console.warn('Failed to save assumptions to localStorage', error)
  }
}

/** Removes the persisted plan, per ERD §5.3. Never throws — swallows any failure, same as
 * `saveAssumptions`/`loadAssumptions`. */
export function clearAssumptions(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch (error) {
    console.warn('Failed to clear assumptions from localStorage', error)
  }
}
