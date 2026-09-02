import { useState } from 'react'
import type { Story, StoryDefault } from '@ladle/react'
import { NumberField } from './NumberField'

export default {
  title: 'Primitives / NumberField',
} satisfies StoryDefault

export const Default: Story = () => {
  const [value, setValue] = useState(65)
  return <NumberField label="Retirement age" value={value} onChange={setValue} min={0} max={120} />
}

export const WithPrefix: Story = () => {
  const [value, setValue] = useState(250000)
  return <NumberField label="Starting balance" value={value} onChange={setValue} min={0} max={10000000} prefix="$" />
}

export const WithSuffix: Story = () => {
  const [value, setValue] = useState(7)
  return <NumberField label="Expected return" value={value} onChange={setValue} min={0} max={100} step={0.1} suffix="%" />
}

export const WithError: Story = () => {
  const [value, setValue] = useState(-5)
  return (
    <NumberField
      label="Retirement age"
      value={value}
      onChange={setValue}
      min={0}
      max={120}
      error="Must be at least 0"
    />
  )
}
