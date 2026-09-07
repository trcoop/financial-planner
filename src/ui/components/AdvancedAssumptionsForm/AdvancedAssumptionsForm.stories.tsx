import { useState } from 'react'
import type { Story, StoryDefault } from '@ladle/react'
import { AdvancedAssumptionsForm, type AdvancedAssumptionValues } from './AdvancedAssumptionsForm'
import { DEFAULT_ADVANCED_VALUES } from './defaults'

export default {
  title: 'Composite / AdvancedAssumptionsForm',
} satisfies StoryDefault

export const Default: Story = () => {
  const [values, setValues] = useState<AdvancedAssumptionValues>(DEFAULT_ADVANCED_VALUES)
  return <AdvancedAssumptionsForm values={values} onChange={setValues} />
}
