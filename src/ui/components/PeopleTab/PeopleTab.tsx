import { Button } from '../Button/Button'
import { NumberField } from '../NumberField/NumberField'
import { SelectField, type SelectFieldOption } from '../SelectField/SelectField'
import { TextField } from '../TextField/TextField'
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog'
import { useState } from 'react'
import { useAsOf } from '../../useAsOf'
import {
  createSpouse,
  personFieldError,
  birthMonthFieldError,
  birthYearFieldError,
  birthYearRange,
  spouseHasAccounts,
  PERSON_FIELD_RANGES,
  type Person,
} from './Person'
import type { AsOf } from '../../../engine/age'
import styles from './PeopleTab.module.css'

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MONTH_OPTIONS: SelectFieldOption[] = [
  { value: '', label: 'Month' },
  ...MONTH_NAMES.map((label, i) => ({ value: String(i + 1), label })),
]

/** Placeholder, then asOf.year-18 down to asOf.year-100. A stored year outside that range is
 * kept as an extra option so existing data is never silently lost (and never repaired). */
function birthYearOptions(stored: number | undefined, asOf: AsOf): SelectFieldOption[] {
  const { min, max } = birthYearRange(asOf)
  const options: SelectFieldOption[] = [{ value: '', label: 'Year' }]
  for (let year = max; year >= min; year--) options.push({ value: String(year), label: String(year) })
  if (stored !== undefined && Number.isFinite(stored) && (stored < min || stored > max || !Number.isInteger(stored))) {
    options.push({ value: String(stored), label: String(stored) })
  }
  return options
}

interface PeopleTabProps {
  people: Person[]
  onChange: (people: Person[]) => void
  /** FIN-117 retrofit: real accounts list, used to drive `spouseHasAccounts` so the
   * cascade-delete warning dialog below fires for a spouse who actually owns accounts.
   * Defaults to `[]` so existing callers/tests that predate Accounts keep working unchanged. */
  accounts?: Array<{ ownerId: string }>
}

/**
 * FIN-116: People tab — each Person's name/age/retirement age/salary, a "+ Spouse" button that
 * hides once a non-primary person exists (only one spouse supported for now, per the PRD), and
 * spouse edit/remove. No contribution field (moved to Account, FIN-117).
 */
export function PeopleTab({ people, onChange, accounts = [] }: PeopleTabProps) {
  const asOf = useAsOf()
  const hasSpouse = people.some((person) => !person.isPrimary)
  const [pendingRemovalId, setPendingRemovalId] = useState<string | null>(null)

  const updatePerson = (id: string, patch: Partial<Person>) => {
    onChange(people.map((person) => (person.id === id ? { ...person, ...patch } : person)))
  }

  const handleAddSpouse = () => {
    onChange([...people, createSpouse(asOf)])
  }

  const removePerson = (id: string) => {
    onChange(people.filter((person) => person.id !== id))
  }

  const handleRequestRemove = (person: Person) => {
    // FIN-117 retrofit: real check against the accounts list — the cascade-delete warning
    // dialog below now fires whenever the spouse being removed actually owns an account.
    if (spouseHasAccounts(person.id, accounts)) {
      setPendingRemovalId(person.id)
    } else {
      removePerson(person.id)
    }
  }

  const pendingRemoval = people.find((person) => person.id === pendingRemovalId)

  return (
    <div className={styles.peopleTab}>
      <div className={styles.header}>
        <h3 className={styles.heading}>People</h3>
        {!hasSpouse && (
          <Button variant="secondary" onClick={handleAddSpouse}>
            + Spouse
          </Button>
        )}
      </div>

      {people.map((person) => (
        <div key={person.id} className={styles.personCard}>
          <div className={styles.personHeader}>
            <span className={styles.personLabel}>{person.isPrimary ? 'You' : 'Spouse'}</span>
            {!person.isPrimary && (
              <Button
                variant="secondary"
                aria-label={`Remove ${person.isPrimary ? 'person' : 'spouse'}`}
                onClick={() => handleRequestRemove(person)}
              >
                Remove
              </Button>
            )}
          </div>
          <div className={styles.fields}>
            <TextField label="Name" value={person.name} onChange={(value) => updatePerson(person.id, { name: value })} />
            <NumberField
              label="Current age"
              value={person.age}
              min={PERSON_FIELD_RANGES.age.min}
              max={PERSON_FIELD_RANGES.age.max}
              error={personFieldError('age', person.age)}
              onChange={(value) => updatePerson(person.id, { age: value })}
            />
            <SelectField
              label="Birth month"
              value={person.birthMonth === undefined ? '' : String(person.birthMonth)}
              options={MONTH_OPTIONS}
              error={birthMonthFieldError(person)}
              onChange={(value) => updatePerson(person.id, { birthMonth: value === '' ? undefined : Number(value) })}
            />
            <SelectField
              label="Birth year"
              value={person.birthYear === undefined ? '' : String(person.birthYear)}
              options={birthYearOptions(person.birthYear, asOf)}
              error={birthYearFieldError(person)}
              onChange={(value) =>
                updatePerson(
                  person.id,
                  value === '' ? { birthYear: undefined } : { birthYear: Number(value), age: asOf.year - Number(value) },
                )
              }
            />
            <NumberField
              label="Retirement age"
              value={person.retirementAge}
              min={PERSON_FIELD_RANGES.retirementAge.min}
              max={PERSON_FIELD_RANGES.retirementAge.max}
              error={personFieldError('retirementAge', person.retirementAge)}
              onChange={(value) => updatePerson(person.id, { retirementAge: value })}
            />
            <NumberField
              label="Salary"
              value={person.salary}
              min={PERSON_FIELD_RANGES.salary.min}
              max={PERSON_FIELD_RANGES.salary.max}
              prefix="$"
              error={personFieldError('salary', person.salary)}
              onChange={(value) => updatePerson(person.id, { salary: value })}
            />
          </div>
        </div>
      ))}

      <ConfirmDialog
        isOpen={pendingRemoval !== undefined}
        title="Remove spouse?"
        message="Removing your spouse will also remove their accounts. If you want to keep those accounts, reassign them to a different owner in the Accounts tab first."
        confirmLabel="Remove"
        cancelLabel="Cancel"
        onConfirm={() => {
          if (pendingRemoval) removePerson(pendingRemoval.id)
          setPendingRemovalId(null)
        }}
        onCancel={() => setPendingRemovalId(null)}
      />
    </div>
  )
}
