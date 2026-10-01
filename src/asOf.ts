import type { AsOf } from './engine/age'

/**
 * FIN-162: the app's single clock read, in a neutral (non-React) module so storage and UI can
 * both source from it. Cached: the clock is read once per page load, so auto-aging never changes
 * a plan mid-session and no `planStartYear` is persisted. The engine and migrations never call
 * this; they receive `asOf` as a parameter.
 */
let cachedSystemAsOf: AsOf | undefined

/** The page-load `{year, month}` (month is 1-12), read from the clock on first call only. */
export function systemAsOf(): AsOf {
  if (!cachedSystemAsOf) {
    const now = new Date()
    cachedSystemAsOf = { year: now.getFullYear(), month: now.getMonth() + 1 }
  }
  return cachedSystemAsOf
}
