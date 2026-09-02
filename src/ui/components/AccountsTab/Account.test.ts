import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_TYPE_OPTIONS,
  accountBalanceError,
  accountContributionError,
  createAccount,
  hasAccountsForOwner,
  seedAccounts,
  type Account,
} from './Account'

describe('createAccount', () => {
  it('creates an account owned by the given ownerId with sensible defaults', () => {
    const account = createAccount('primary')
    expect(account.ownerId).toBe('primary')
    expect(account.balance).toBe(0)
    expect(account.contributionMode).toBe('percentage')
    expect(account.contributionValue).toBe(0)
    expect(account.type).toBe('taxable')
    expect(account.name.length).toBeGreaterThan(0)
  })

  it('generates a unique id per account', () => {
    const a = createAccount('primary')
    const b = createAccount('primary')
    expect(a.id).not.toBe(b.id)
  })
})

describe('ACCOUNT_TYPE_OPTIONS', () => {
  it('offers exactly Taxable, Roth, Traditional', () => {
    expect(ACCOUNT_TYPE_OPTIONS.map((option) => option.label)).toEqual(['Taxable', 'Roth', 'Traditional'])
  })
})

describe('accountBalanceError', () => {
  it('rejects a negative balance', () => {
    expect(accountBalanceError(-1)).toBeDefined()
  })

  it('accepts zero and large positive balances', () => {
    expect(accountBalanceError(0)).toBeUndefined()
    expect(accountBalanceError(1_000_000)).toBeUndefined()
  })
})

describe('accountContributionError', () => {
  it('bounds percentage mode to 0-100', () => {
    expect(accountContributionError('percentage', 50)).toBeUndefined()
    expect(accountContributionError('percentage', 101)).toBeDefined()
    expect(accountContributionError('percentage', -1)).toBeDefined()
  })

  it('allows a fixed dollar amount above 100', () => {
    expect(accountContributionError('fixed', 5000)).toBeUndefined()
  })

  it('rejects a negative fixed amount', () => {
    expect(accountContributionError('fixed', -1)).toBeDefined()
  })
})

describe('seedAccounts', () => {
  it('returns an empty array for a pre-FIN-117 record with no accounts field', () => {
    expect(seedAccounts(undefined)).toEqual([])
  })

  it('returns an empty array for a malformed value', () => {
    expect(seedAccounts('not an array')).toEqual([])
  })

  it('returns an already-persisted accounts array unchanged', () => {
    const accounts: Account[] = [createAccount('primary')]
    expect(seedAccounts(accounts)).toEqual(accounts)
  })
})

describe('hasAccountsForOwner', () => {
  it('is false when no account has that ownerId', () => {
    expect(hasAccountsForOwner([{ ownerId: 'a' }], 'b')).toBe(false)
  })

  it('is true when at least one account has that ownerId', () => {
    expect(hasAccountsForOwner([{ ownerId: 'a' }, { ownerId: 'b' }], 'b')).toBe(true)
  })
})
