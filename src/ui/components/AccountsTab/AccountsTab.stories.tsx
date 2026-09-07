import { useState } from 'react'
import type { Story, StoryDefault } from '@ladle/react'
import { AccountsTab } from './AccountsTab'
import type { Account } from './Account'
import { createPrimaryPerson } from '../PeopleTab/Person'
import { DEFAULT_CORE_VALUES } from '../../coreInputs/defaults'

export default {
  title: 'Composite / AccountsTab',
} satisfies StoryDefault

const PRIMARY = createPrimaryPerson(DEFAULT_CORE_VALUES)

const ACCOUNTS: Account[] = [
  {
    id: 'acc-1',
    name: '401(k)',
    type: 'traditional',
    balance: 250_000,
    contributionMode: 'percentage',
    contributionPercentage: 15,
    contributionFixed: 0,
    ownerId: PRIMARY.id,
  },
  {
    id: 'acc-2',
    name: 'Brokerage',
    type: 'taxable',
    balance: 40_000,
    contributionMode: 'fixed',
    contributionPercentage: 0,
    contributionFixed: 500,
    ownerId: PRIMARY.id,
  },
]

export const Default: Story = () => {
  const [accounts, setAccounts] = useState<Account[]>(ACCOUNTS)
  return <AccountsTab accounts={accounts} people={[PRIMARY]} onChange={setAccounts} />
}
