import { useState } from 'react'
import type { Story, StoryDefault } from '@ladle/react'
import { Checkbox } from './Checkbox'

export default {
  title: 'Primitives / Checkbox',
} satisfies StoryDefault

export const Unchecked: Story = () => {
  const [checked, setChecked] = useState(false)
  return <Checkbox label="I have a spouse" checked={checked} onChange={setChecked} />
}

export const Checked: Story = () => {
  const [checked, setChecked] = useState(true)
  return <Checkbox label="I have a spouse" checked={checked} onChange={setChecked} />
}
