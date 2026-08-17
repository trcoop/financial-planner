import type { ReactNode } from 'react'
import styles from './Layout.module.css'

interface LayoutProps {
  form: ReactNode
  results: ReactNode
}

export function Layout({ form, results }: LayoutProps) {
  return (
    <div className={styles.layout}>
      <section aria-label="Plan inputs">
        {form}
      </section>
      <section aria-label="Projection results">
        {results}
      </section>
    </div>
  )
}
