import type { AsOf } from './engine/age'

/** Frozen "today" for tests (September 2026) so no test depends on the real clock. */
export const TEST_ASOF: AsOf = { year: 2026, month: 9 }
