import type { HTMLAttributes, ReactNode } from 'react'
import styles from './Card.module.css'

type CardPadding = 'default' | 'compact'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  padding?: CardPadding
}

const paddingClass: Record<CardPadding, string> = {
  default: styles.paddingDefault,
  compact: styles.paddingCompact,
}

export function Card({ children, padding = 'default', className, ...rest }: CardProps) {
  const classNames = [styles.card, paddingClass[padding], className].filter(Boolean).join(' ')

  return (
    <div className={classNames} {...rest}>
      {children}
    </div>
  )
}
