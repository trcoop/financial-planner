import { describe, expect, it } from 'vitest'
import type { CoreInputValues } from '../CoreInputsForm/CoreInputsForm'
import { DEFAULT_CORE_VALUES } from '../CoreInputsForm/defaults'
import {
  ACCOUNT_TYPE_OPTIONS,
  accountBalanceError,
  accountContributionError,
  createAccount,
  hasAccountsForOwner,
  seedAccounts,
  syncCoreWithPrimaryAccount,
  type Account,
} from './Account'

const core: CoreInputValues = DEFAULT_CORE_VALUES

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
  it('seeds exactly one default account for a pre-FIN-117 record with no accounts field, matching the old core values', () => {
    const seeded = seedAccounts(undefined, 'primary', core)
    expect(seeded).toHaveLength(1)
    expect(seeded[0].ownerId).toBe('primary')
    expect(seeded[0].balance).toBe(core.initialBalance)
    expect(seeded[0].contributionMode).toBe('percentage')
    expect(seeded[0].contributionValue).toBe(core.annualContributionRatePercent)
    expect(seeded[0].type).toBe('taxable')
  })

  it('seeds a default account for a malformed value', () => {
    expect(seedAccounts('not an array', 'primary', core)).toHaveLength(1)
  })

  it('leaves an already-persisted accounts array unchanged, including an explicitly empty one (no double-seeding)', () => {
    const accounts: Account[] = [createAccount('primary')]
    expect(seedAccounts(accounts, 'primary', core)).toEqual(accounts)
    expect(seedAccounts([], 'primary', core)).toEqual([])
  })
})

describe('syncCoreWithPrimaryAccount', () => {
  it('overrides initialBalance/annualContributionRatePercent from a percentage-mode account', () => {
    const account: Account = { ...createAccount('primary'), balance: 42_000, contributionValue: 12 }
    const synced = syncCoreWithPrimaryAccount(core, account)
    expect(synced.initialBalance).toBe(42_000)
    expect(synced.annualContributionRatePercent).toBe(12)
  })

  it('zeroes both fields when there is no primary account, rather than leaving stale core values', () => {
    const staleCore: CoreInputValues = { ...core, initialBalance: 250_000, annualContributionRatePercent: 15 }
    const synced = syncCoreWithPrimaryAccount(staleCore, undefined)
    expect(synced.initialBalance).toBe(0)
    expect(synced.annualContributionRatePercent).toBe(0)
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
