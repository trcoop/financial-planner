import { Card } from '../Card/Card'
import styles from './StatTile.module.css'

export interface StatTileProps {
  label: string
  value: string
  /** True when `value` is placeholder/secondary text (e.g. "Run a stress test to see this") rather than a real result. */
  isPlaceholder?: boolean
}

export function StatTile({ label, value, isPlaceholder = false }: StatTileProps) {
  const valueClassNames = [styles.value, isPlaceholder ? styles.placeholder : null].filter(Boolean).join(' ')

  return (
    <Card padding="compact" className={styles.tile}>
      <section aria-label={label}>
        <p className={styles.label}>{label}</p>
        <p className={valueClassNames}>{value}</p>
      </section>
    </Card>
  )
}
