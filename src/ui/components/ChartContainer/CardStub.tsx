import type { ReactNode } from 'react'
import styles from './CardStub.module.css'

/**
 * Stand-in for the real `Card` component owned by FIN-24 (Card/StatTile ticket), which had
 * not landed on `main` as of this ticket (FIN-25). Built against FIN-24's documented prop
 * contract: `children` plus an optional padding variant. Not a copy of FIN-24's
 * implementation — a minimal local surface so ChartContainer/YearDetailPanel have something
 * to render against.
 *
 * Swap: once `src/ui/components/Card` lands on `main`, replace the `CardStub` import in
 * `ChartContainer.tsx` and `YearDetailPanel.tsx` with the real `Card` and delete this file
 * and `CardStub.module.css`. No other change should be required — both callers use only the
 * `children`/`padding` surface documented for `Card`.
 */
export interface CardStubProps {
  children: ReactNode
  padding?: 'none' | 'default'
  className?: string
}

export function CardStub({ children, padding = 'default', className }: CardStubProps) {
  const classes = [styles.card, padding === 'none' ? styles.paddingNone : styles.paddingDefault, className]
    .filter(Boolean)
    .join(' ')
  return <div className={classes}>{children}</div>
}
