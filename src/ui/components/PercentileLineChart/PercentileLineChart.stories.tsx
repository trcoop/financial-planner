import type { Story, StoryDefault } from '@ladle/react'
import { PercentileLineChart, type LineChartRow, type LineChartSeries } from './PercentileLineChart'

export default {
  title: 'Composite / PercentileLineChart',
} satisfies StoryDefault

const rows: LineChartRow[] = [
  { age: 35, year: 0, values: { p10: 80_000, p50: 110_000, p90: 160_000 } },
  { age: 36, year: 1, values: { p10: 90_000, p50: 130_000, p90: 200_000 } },
  { age: 37, year: 2, values: { p10: 100_000, p50: 160_000, p90: 260_000 } },
]

const series: LineChartSeries[] = [
  { key: 'p90', label: '90th percentile', color: 'var(--color-success)' },
  { key: 'p50', label: 'Median (50th percentile)', color: 'var(--color-primary)' },
  { key: 'p10', label: '10th percentile', color: 'var(--color-warning)' },
]

export const Default: Story = () => <PercentileLineChart rows={rows} series={series} title="Monte Carlo outcomes" />
