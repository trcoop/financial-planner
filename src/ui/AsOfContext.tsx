import { createContext, useContext, useState, type ReactNode } from 'react'
import type { AsOf } from '../engine/age'

/**
 * FIN-162: the UI's single clock read. The engine never reads a clock (PRD E27) — it receives an
 * `asOf` injected from here. The clock is read once per page load (cached below), so auto-aging
 * never changes a plan mid-session and no `planStartYear` is persisted.
 */
let cachedSystemAsOf: AsOf | undefined

/** The page-load `{year, month}` (month 1-12), read from the clock on first call only. */
// oxlint-disable-next-line react/only-export-components -- hook/clock helper intentionally co-located with its provider (ticket-specified module)
export function systemAsOf(): AsOf {
  if (!cachedSystemAsOf) {
    const now = new Date()
    cachedSystemAsOf = { year: now.getFullYear(), month: now.getMonth() + 1 }
  }
  return cachedSystemAsOf
}

const AsOfContext = createContext<AsOf | undefined>(undefined)

/** Mounted once in `main.tsx`. Reads the clock once when first mounted and holds that value. */
export function AsOfProvider({ children }: { children: ReactNode }) {
  const [asOf] = useState<AsOf>(() => ({ ...clockNow() }))
  return <AsOfContext.Provider value={asOf}>{children}</AsOfContext.Provider>
}

function clockNow(): AsOf {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

/** Test/story helper: supplies a constant `asOf` so output never depends on the real date. */
export function FrozenAsOfProvider({ asOf, children }: { asOf: AsOf; children: ReactNode }) {
  return <AsOfContext.Provider value={asOf}>{children}</AsOfContext.Provider>
}

/** The injected `asOf`. Outside any provider it falls back to the cached page-load clock read. */
// oxlint-disable-next-line react/only-export-components -- see above
export function useAsOf(): AsOf {
  return useContext(AsOfContext) ?? systemAsOf()
}
