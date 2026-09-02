import { useState } from 'react'
import type { Story, StoryDefault } from '@ladle/react'
import { Dropdown, type DropdownOption } from './Dropdown'

export default {
  title: 'Primitives / Dropdown',
} satisfies StoryDefault

const options: DropdownOption[] = [
  { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'annually', label: 'Annually' },
]

export const Default: Story = () => {
  const [selectedId, setSelectedId] = useState('monthly')
  return <Dropdown options={options} selectedId={selectedId} onSelect={setSelectedId} ariaLabel="Compounding frequency" />
}

export const FullWidth: Story = () => {
  const [selectedId, setSelectedId] = useState('monthly')
  return (
    <div style={{ maxWidth: 320 }}>
      <Dropdown options={options} selectedId={selectedId} onSelect={setSelectedId} ariaLabel="Compounding frequency" fullWidth />
    </div>
  )
}

export const Invalid: Story = () => {
  const [selectedId, setSelectedId] = useState('monthly')
  return (
    <Dropdown
      options={options}
      selectedId={selectedId}
      onSelect={setSelectedId}
      ariaLabel="Compounding frequency"
      ariaInvalid
    />
  )
}
