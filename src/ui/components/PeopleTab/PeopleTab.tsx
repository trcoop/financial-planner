import { Button } from '../Button/Button'
import { NumberField } from '../NumberField/NumberField'
import { TextField } from '../TextField/TextField'
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog'
import { useState } from 'react'
import {
  createSpouse,
  personFieldError,
  spouseHasAccounts,
  PERSON_FIELD_RANGES,
  type Person,
} from './Person'
import styles from './PeopleTab.module.css'

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
  const hasSpouse = people.some((person) => !person.isPrimary)
  const [pendingRemovalId, setPendingRemovalId] = useState<string | null>(null)

  const updatePerson = (id: string, patch: Partial<Person>) => {
    onChange(people.map((person) => (person.id === id ? { ...person, ...patch } : person)))
  }

  const handleAddSpouse = () => {
    onChange([...people, createSpouse()])
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
        title="Delete spouse?"
        message="Deleting your spouse will also delete their accounts. If you want to keep those accounts, reassign them to a different owner in the Accounts tab first."
        confirmLabel="Delete"
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
