import { describe, expect, it } from 'vitest'
import type { CoreInputValues } from '../../coreInputs/types'
import { DEFAULT_CORE_VALUES } from '../../coreInputs/defaults'
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
    expect(account.contributionPercentage).toBe(0)
    expect(account.contributionFixed).toBe(0)
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
    expect(seeded[0].contributionPercentage).toBe(core.annualContributionRatePercent)
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

  it('repairs a pre-contribution-split persisted account (legacy contributionValue, no contributionPercentage/contributionFixed) into a valid Account with finite fields, not NaN', () => {
    const legacyAccount = {
      id: 'acct-1',
      name: 'Primary account',
      type: 'taxable',
      balance: 250_000,
      contributionMode: 'percentage',
      contributionValue: 15,
      ownerId: 'primary',
    }
    const [seeded] = seedAccounts([legacyAccount], 'primary', core)
    expect(Number.isFinite(seeded.balance)).toBe(true)
    expect(Number.isFinite(seeded.contributionPercentage)).toBe(true)
    expect(Number.isFinite(seeded.contributionFixed)).toBe(true)
    expect(seeded.contributionPercentage).toBe(15)
    expect(seeded.contributionFixed).toBe(0)
    expect(seeded.balance).toBe(250_000)
    expect(seeded.ownerId).toBe('primary')
  })

  it('repairs an account with non-finite balance/contribution fields to safe defaults', () => {
    const malformedAccount = {
      id: 'acct-2',
      balance: undefined,
      contributionMode: 'fixed',
      contributionPercentage: NaN,
      contributionFixed: undefined,
      ownerId: 'primary',
    }
    const [seeded] = seedAccounts([malformedAccount], 'primary', core)
    expect(seeded.balance).toBe(0)
    expect(seeded.contributionPercentage).toBe(0)
    expect(seeded.contributionFixed).toBe(0)
    expect(Number.isFinite(seeded.balance)).toBe(true)
  })
})

describe('syncCoreWithPrimaryAccount', () => {
  it('overrides initialBalance/annualContributionRatePercent from a percentage-mode account', () => {
    const account: Account = { ...createAccount('primary'), balance: 42_000, contributionPercentage: 12 }
    const synced = syncCoreWithPrimaryAccount(core, [account], 'primary')
    expect(synced.initialBalance).toBe(42_000)
    expect(synced.annualContributionRatePercent).toBe(12)
  })

  it('zeroes both fields when there are no accounts at all, rather than leaving stale core values', () => {
    const staleCore: CoreInputValues = { ...core, initialBalance: 250_000, annualContributionRatePercent: 15 }
    const synced = syncCoreWithPrimaryAccount(staleCore, [], 'primary')
    expect(synced.initialBalance).toBe(0)
    expect(synced.annualContributionRatePercent).toBe(0)
  })

  it('sums initialBalance across every account owned by the primary, not just the first', () => {
    const accountA: Account = { ...createAccount('primary'), balance: 42_000, contributionPercentage: 12 }
    const accountB: Account = { ...createAccount('primary'), balance: 8_000 }
    const synced = syncCoreWithPrimaryAccount(core, [accountA, accountB], 'primary')
    expect(synced.initialBalance).toBe(50_000)
    expect(synced.annualContributionRatePercent).toBe(12)
  })

  it('sums initialBalance across spouse-owned accounts too — this is the household starting balance', () => {
    const primaryAccount: Account = { ...createAccount('primary'), balance: 42_000, contributionPercentage: 12 }
    const spouseAccount: Account = { ...createAccount('spouse'), balance: 100_000 }
    const synced = syncCoreWithPrimaryAccount(core, [primaryAccount, spouseAccount], 'primary')
    expect(synced.initialBalance).toBe(142_000)
    // Contribution rate is still derived only from the primary's own first account — unaffected
    // by this fix (see the function's doc comment).
    expect(synced.annualContributionRatePercent).toBe(12)
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
