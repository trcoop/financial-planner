import { createContext, useContext } from 'react'
import type { AsOf } from '../engine/age'
import { systemAsOf } from '../asOf'

export const AsOfContext = createContext<AsOf | undefined>(undefined)

/** The injected `asOf`. Outside any provider it falls back to the cached page-load clock read. */
export function useAsOf(): AsOf {
  return useContext(AsOfContext) ?? systemAsOf()
}
