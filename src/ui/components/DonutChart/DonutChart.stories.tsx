import type { Story, StoryDefault } from '@ladle/react'
import { DonutChart, type DonutSegment } from './DonutChart'

export default {
  title: 'Composite / DonutChart',
} satisfies StoryDefault

const segments: DonutSegment[] = [
  { label: 'Starting amount', value: 10_000 },
  { label: 'Contributions', value: 24_000 },
  { label: 'Growth', value: 16_000 },
]

export const Default: Story = () => <DonutChart segments={segments} title="Contributions vs. growth" />
