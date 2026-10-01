import { useState, type ReactNode } from 'react'
import type { AsOf } from '../engine/age'
import { systemAsOf } from '../asOf'
import { AsOfContext } from './useAsOf'

/** Mounted once in `main.tsx`. Reads the clock once when first mounted and holds that value. */
export function AsOfProvider({ children }: { children: ReactNode }) {
  const [asOf] = useState<AsOf>(() => systemAsOf())
  return <AsOfContext.Provider value={asOf}>{children}</AsOfContext.Provider>
}

/** Test/story helper: supplies a constant `asOf` so output never depends on the real date. */
export function FrozenAsOfProvider({ asOf, children }: { asOf: AsOf; children: ReactNode }) {
  return <AsOfContext.Provider value={asOf}>{children}</AsOfContext.Provider>
}
