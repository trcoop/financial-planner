import { useState } from 'react'
import type { Story, StoryDefault } from '@ladle/react'
import { TextField } from './TextField'

export default {
  title: 'Primitives / TextField',
} satisfies StoryDefault

export const Default: Story = () => {
  const [value, setValue] = useState('Jane Doe')
  return <TextField label="Name" value={value} onChange={setValue} />
}

export const Empty: Story = () => {
  const [value, setValue] = useState('')
  return <TextField label="Name" value={value} onChange={setValue} placeholder="e.g. Jane Doe" />
}

export const WithError: Story = () => {
  const [value, setValue] = useState('')
  return <TextField label="Name" value={value} onChange={setValue} error="Name is required" />
}
