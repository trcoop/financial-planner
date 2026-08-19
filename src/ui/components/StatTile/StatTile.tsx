import type { ReactNode } from 'react'
import { Card } from '../Card/Card'
import styles from './StatTile.module.css'

export interface StatTileProps {
  label: string
  value: string
  /** True when `value` is placeholder/secondary text (e.g. "Run a stress test to see this") rather than a real result. */
  isPlaceholder?: boolean
  /**
   * FIN-48: when provided, renders in place of `value` — e.g. a "Re-run stress test" CTA
   * shown once inputs have changed since the tile's last completed result, so the tile
   * itself doubles as the staleness signal and the one-click fix. `value` is still required
   * so callers keep a real fallback and so this prop is purely additive.
   */
  action?: ReactNode
}

export function StatTile({ label, value, isPlaceholder = false, action }: StatTileProps) {
  const valueClassNames = [styles.value, isPlaceholder ? styles.placeholder : null].filter(Boolean).join(' ')

  return (
    <Card padding="compact" className={styles.tile}>
      <section aria-label={label}>
        <p className={styles.label}>{label}</p>
        {action ?? <p className={valueClassNames}>{value}</p>}
      </section>
    </Card>
  )
}
