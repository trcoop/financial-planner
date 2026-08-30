import { forwardRef } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlanSection } from './PlanSection'

/**
 * FIN-98/ERD: a freshly-mounted PlanSection has no prior in-memory stress test result, so its
 * `isStressTestStale` must initialize to `true` — this is what makes the "chance of success"
 * StatTile show a "Re-run stress test" CTA (rather than a bare success rate) the moment a
 * success rate becomes available without an intervening completed run.
 *
 * That initializer is otherwise unreachable by any other test in this suite: the real
 * `StressTestSection` owns its own `isStale` state, which starts `false` and reports it up via
 * `onStaleChange` in a `useEffect` that fires (and overwrites PlanSection's initial `true`)
 * before any test assertion can run. So `PlanSection.test.tsx`'s existing staleness coverage
 * only ever exercises `StressTestSection`'s post-mount transitions — not PlanSection's own
 * initializer.
 *
 * To exercise the initializer specifically, this file replaces the real `StressTestSection`
 * with a controllable fake that captures its `onSuccessRateChange`/`onStaleChange` props but
 * never calls `onStaleChange` on its own — so any staleness value observed here can only have
 * come from PlanSection's own `useState` initializer, not from the child's wiring.
 */
let lastStressTestProps: {
  onSuccessRateChange?: (rate: number | null) => void
  onStaleChange?: (isStale: boolean) => void
} = {}

vi.mock('./components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./components')>()
  return {
    ...actual,
    StressTestSection: forwardRef((props: typeof lastStressTestProps, _ref: unknown) => {
      lastStressTestProps = props
      // Deliberately does not call onStaleChange at all (unlike the real component, which
      // calls it on mount with its own isStale-starts-false) — so PlanSection's own initial
      // isStressTestStale value is left untouched by this fake.
      return <div data-testid="fake-stress-test-section" />
    }),
  }
})

function mockMatchMedia(isDesktop: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: isDesktop,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

describe('PlanSection fresh-mount staleness initializer (FIN-98)', () => {
  afterEach(() => cleanup())

  it('starts isStressTestStale true on mount: surfaces the Re-run CTA the instant a success rate arrives, with no staleness signal from the child yet', () => {
    mockMatchMedia(true)
    render(<PlanSection />)

    // Before any success rate exists, the CTA can't show regardless of staleness (StatTile
    // only renders it once successRate !== null) — this just gets to a state where staleness
    // is the only thing left gating the CTA.
    expect(screen.queryByRole('button', { name: 'Re-run stress test' })).not.toBeInTheDocument()

    act(() => {
      lastStressTestProps.onSuccessRateChange?.(87)
    })

    // StatTile's `action` prop (the CTA) replaces its `value` text entirely when present, so
    // "87%" itself isn't asserted here — the CTA's mere presence is what's gated on
    // `isStressTestStale && successRate !== null`. The fake StressTestSection above never
    // called onStaleChange, so this can only be showing because PlanSection's own
    // `isStressTestStale` initializer is `true`. If a future change flipped that initializer
    // to `false`, this assertion would fail.
    expect(screen.getByRole('button', { name: 'Re-run stress test' })).toBeInTheDocument()
    expect(screen.queryByText('87%')).not.toBeInTheDocument()
  })
})
