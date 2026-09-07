import type { Story, StoryDefault } from '@ladle/react'
import { Layout } from './Layout'

export default {
  title: 'Composite / Layout',
} satisfies StoryDefault

export const Default: Story = () => (
  <Layout form={<p>Form content</p>} results={<p>Results content</p>} />
)
