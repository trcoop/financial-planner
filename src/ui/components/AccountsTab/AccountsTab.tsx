import { useState } from 'react'
import { Button } from '../Button/Button'
import { NumberField } from '../NumberField/NumberField'
import { TextField } from '../TextField/TextField'
import { SelectField } from '../SelectField/SelectField'
import { ToggleGroup } from '../InvestmentCalculator/ToggleGroup'
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog'
import type { Person } from '../PeopleTab/Person'
import {
  ACCOUNT_FIELD_RANGES,
  ACCOUNT_TYPE_OPTIONS,
  accountBalanceError,
  accountContributionError,
  createAccount,
  type Account,
  type ContributionMode,
} from './Account'
import styles from './AccountsTab.module.css'

interface AccountsTabProps {
  accounts: Account[]
  /** Current People list — the owner dropdown is populated live from this (FIN-117 AC). */
  people: Person[]
  onChange: (accounts: Account[]) => void
}

const CONTRIBUTION_MODE_OPTIONS: Array<{ value: ContributionMode; label: string }> = [
  { value: 'percentage', label: 'Percentage' },
  { value: 'fixed', label: 'Fixed Amount' },
]

function ownerLabel(person: Person): string {
  return person.isPrimary ? 'You' : 'Spouse'
}

/**
 * FIN-117: Accounts tab — "+ Account" header button, per-account CRUD (name/type/balance/
 * contribution/owner), a percentage/fixed contribution toggle that swaps the visible field, and
 * a delete confirmation. Owner is a required field on every account (`createAccount`), so an
 * account can only be created once at least one Person exists — the primary Person always
 * exists (`PeopleTab`'s pre-load), so this is never blocked in practice.
 */
export function AccountsTab({ accounts, people, onChange }: AccountsTabProps) {
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const updateAccount = (id: string, patch: Partial<Account>) => {
    onChange(accounts.map((account) => (account.id === id ? { ...account, ...patch } : account)))
  }

  const handleAddAccount = () => {
    const defaultOwnerId = people[0]?.id
    if (!defaultOwnerId) return
    onChange([...accounts, createAccount(defaultOwnerId)])
  }

  const removeAccount = (id: string) => {
    onChange(accounts.filter((account) => account.id !== id))
  }

  const pendingDelete = accounts.find((account) => account.id === pendingDeleteId)

  return (
    <div className={styles.accountsTab}>
      <div className={styles.header}>
        <h3 className={styles.heading}>Accounts</h3>
        <Button variant="secondary" onClick={handleAddAccount}>
          + Account
        </Button>
      </div>

      {accounts.length === 0 && (
        <p className={styles.emptyState}>No accounts yet — add your first account to start tracking balances.</p>
      )}

      {accounts.map((account) => (
        <div key={account.id} className={styles.accountCard}>
          <div className={styles.accountHeader}>
            <Button variant="secondary" aria-label="Remove account" onClick={() => setPendingDeleteId(account.id)}>
              Remove
            </Button>
          </div>
          <div className={styles.fields}>
            <TextField
              label="Account name"
              value={account.name}
              onChange={(value) => updateAccount(account.id, { name: value })}
            />
            <SelectField
              label="Account type"
              value={account.type}
              onChange={(value) => updateAccount(account.id, { type: value as Account['type'] })}
              options={ACCOUNT_TYPE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            />
            <NumberField
              label="Balance"
              value={account.balance}
              min={ACCOUNT_FIELD_RANGES.balance.min}
              max={ACCOUNT_FIELD_RANGES.balance.max}
              prefix="$"
              error={accountBalanceError(account.balance)}
              onChange={(value) => updateAccount(account.id, { balance: value })}
            />
            <SelectField
              label="Owner"
              value={account.ownerId}
              onChange={(value) => updateAccount(account.id, { ownerId: value })}
              options={people.map((person) => ({ value: person.id, label: ownerLabel(person) }))}
            />
            <ToggleGroup
              label="Contribution"
              value={account.contributionMode}
              onChange={(value) => updateAccount(account.id, { contributionMode: value as ContributionMode })}
              options={CONTRIBUTION_MODE_OPTIONS}
            />
            {/* FIN-117 bug-fix round: percentage and fixed each remember their own value
              * independently (`contributionPercentage`/`contributionFixed`) — switching modes
              * shows that mode's own last-set value rather than reinterpreting the other mode's
              * number (15% becoming $15, or vice versa). */}
            {account.contributionMode === 'percentage' ? (
              <NumberField
                label="Contribution %"
                value={account.contributionPercentage}
                min={ACCOUNT_FIELD_RANGES.contributionPercentage.min}
                max={ACCOUNT_FIELD_RANGES.contributionPercentage.max}
                suffix="%"
                error={accountContributionError('percentage', account.contributionPercentage)}
                onChange={(value) => updateAccount(account.id, { contributionPercentage: value })}
              />
            ) : (
              <NumberField
                label="Contribution $"
                value={account.contributionFixed}
                min={ACCOUNT_FIELD_RANGES.contributionFixed.min}
                max={ACCOUNT_FIELD_RANGES.contributionFixed.max}
                prefix="$"
                error={accountContributionError('fixed', account.contributionFixed)}
                onChange={(value) => updateAccount(account.id, { contributionFixed: value })}
              />
            )}
          </div>
        </div>
      ))}

      <ConfirmDialog
        isOpen={pendingDelete !== undefined}
        title="Remove account?"
        message="This account and its balance/contribution data will be permanently removed. This can't be undone."
        confirmLabel="Remove"
        cancelLabel="Cancel"
        onConfirm={() => {
          if (pendingDelete) removeAccount(pendingDelete.id)
          setPendingDeleteId(null)
        }}
        onCancel={() => setPendingDeleteId(null)}
      />
    </div>
  )
}
