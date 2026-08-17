import type { ReactNode } from 'react'
import styles from './Layout.module.css'

interface LayoutProps {
  form: ReactNode
  results: ReactNode
}

export function Layout({ form, results }: LayoutProps) {
  return (
    <div className={styles.layout}>
      <section className={styles.form} aria-label="Plan inputs">
        {form}
      </section>
      <section className={styles.results} aria-label="Projection results">
        {results}
      </section>
    </div>
  )
}
