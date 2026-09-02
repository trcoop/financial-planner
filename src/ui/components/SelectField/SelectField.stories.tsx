import { useState } from 'react'
import type { Story, StoryDefault } from '@ladle/react'
import { SelectField, type SelectFieldOption } from './SelectField'

export default {
  title: 'Primitives / SelectField',
} satisfies StoryDefault

const options: SelectFieldOption[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annually', label: 'Annually' },
]

export const Labeled: Story = () => {
  const [value, setValue] = useState('monthly')
  return <SelectField label="Contribution frequency" value={value} onChange={setValue} options={options} />
}

export const NoVisibleLabel: Story = () => {
  const [value, setValue] = useState('monthly')
  return (
    <SelectField
      ariaLabel="Choose calculator"
      value={value}
      onChange={setValue}
      options={options}
      fullWidth={false}
    />
  )
}

export const WithError: Story = () => {
  const [value, setValue] = useState('monthly')
  return (
    <SelectField
      label="Contribution frequency"
      value={value}
      onChange={setValue}
      options={options}
      error="Selection required"
    />
  )
}
