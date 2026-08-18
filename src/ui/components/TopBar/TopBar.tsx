import styles from './TopBar.module.css'

export function TopBar() {
  return (
    <header className={styles.topBar}>
      <span className={styles.logo} aria-hidden="true" />
      <span className={styles.appName}>Financial Planner</span>
    </header>
  )
}
