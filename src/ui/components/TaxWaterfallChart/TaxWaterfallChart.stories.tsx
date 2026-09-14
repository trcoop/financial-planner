import type { Story, StoryDefault } from '@ladle/react'
import { computeFederalTax, STORY_FIXTURES } from '../../../engine/tax'
import { TaxWaterfallChart } from './TaxWaterfallChart'

export default {
  title: 'Composite / TaxWaterfallChart',
} satisfies StoryDefault

// Every story is driven by real `computeFederalTax` output over the shared §8.5 fixtures
// (`STORY_FIXTURES`, authored by WP-F) — never a hand-written fixture — so a story proves
// something about the engine, not just about the chart. All six pin `year: 2026`, a published
// actuals year, so the output (and therefore each Playwright baseline) is deterministic.

export const ZeroTax: Story = () => (
  <TaxWaterfallChart result={computeFederalTax(STORY_FIXTURES.ZeroTax)} title="Zero tax — standard deduction exceeds income" />
)

export const MiddleIncome: Story = () => (
  <TaxWaterfallChart result={computeFederalTax(STORY_FIXTURES.MiddleIncome)} title="Middle income — several ordinary brackets" />
)

export const TopBracket: Story = () => (
  <TaxWaterfallChart result={computeFederalTax(STORY_FIXTURES.TopBracket)} title="Top bracket — high income" />
)

export const PreferentialHeavy: Story = () => (
  <TaxWaterfallChart
    result={computeFederalTax(STORY_FIXTURES.PreferentialHeavy)}
    title="Preferential-heavy — widened 0% LTCG band"
  />
)

export const Age65Single: Story = () => (
  <TaxWaterfallChart result={computeFederalTax(STORY_FIXTURES.Age65Single)} title="Age 65 single — age addition" />
)

export const SeniorBonusPhaseOut: Story = () => (
  <TaxWaterfallChart
    result={computeFederalTax(STORY_FIXTURES.SeniorBonusPhaseOut)}
    title="Senior bonus phase-out — mid phase-out"
  />
)
