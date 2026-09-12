import type { Story, StoryDefault } from '@ladle/react'
import { computeFederalTax } from '../../../engine'
import { STORY_FIXTURES } from '../../../engine/tax'
import { BracketLadderChart } from './BracketLadderChart'

export default {
  title: 'Composite / BracketLadderChart',
} satisfies StoryDefault

// Every story renders REAL `computeFederalTax` output over the shared `STORY_FIXTURES` (ERD
// §8.5) — never a hand-written fixture, so each story is also a live check that the chart
// renders whatever the engine actually produces for that scenario.

export const ZeroTax: Story = () => (
  <BracketLadderChart result={computeFederalTax(STORY_FIXTURES.ZeroTax)} title="Zero tax — standard deduction exceeds income" />
)

export const MiddleIncome: Story = () => (
  <BracketLadderChart
    result={computeFederalTax(STORY_FIXTURES.MiddleIncome)}
    title="Middle income — spans several ordinary brackets"
  />
)

export const TopBracket: Story = () => (
  <BracketLadderChart result={computeFederalTax(STORY_FIXTURES.TopBracket)} title="Top bracket — high income" />
)

export const PreferentialHeavy: Story = () => (
  <BracketLadderChart
    result={computeFederalTax(STORY_FIXTURES.PreferentialHeavy)}
    title="Preferential-heavy — widened 0% LTCG band"
    showPreferential
  />
)

export const Age65Single: Story = () => (
  <BracketLadderChart
    result={computeFederalTax(STORY_FIXTURES.Age65Single)}
    title="Age 65, single filer — age addition"
  />
)

export const SeniorBonusPhaseOut: Story = () => (
  <BracketLadderChart
    result={computeFederalTax(STORY_FIXTURES.SeniorBonusPhaseOut)}
    title="Senior bonus phase-out — single, age 65, mid phase-out"
  />
)
