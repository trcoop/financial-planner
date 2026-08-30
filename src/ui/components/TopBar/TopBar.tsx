import styles from './TopBar.module.css'

/* Bar-chart logo mark — matches the Direction B mockup's TopBar glyph exactly (three bars,
 * accent/white/accent), not a generic color block. Static decorative markup only (aria-hidden),
 * no interactive behavior — see FIN-90 round 2. */
function LogoMark() {
  return (
    <svg
      className={styles.logo}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 20 L4 12 L9 12 L9 20 Z" fill="var(--color-primary)" />
      <path d="M10.5 20 L10.5 6 L15.5 6 L15.5 20 Z" fill="#ffffff" />
      <path d="M17 20 L17 15 L22 15 L22 20 Z" fill="var(--color-primary)" />
    </svg>
  )
}

export function TopBar() {
  return (
    <header className={styles.topBar}>
      <LogoMark />
      <span className={styles.appName}>Financial Planner</span>
    </header>
  )
}
