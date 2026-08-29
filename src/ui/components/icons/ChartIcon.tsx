interface IconProps {
  className?: string
}

/**
 * Line-chart glyph used for the Plan nav item (BottomTabBar).
 * Inline SVG only — no icon font, npm icon package, or CDN reference,
 * per the app's zero-network-calls constraint.
 */
export function ChartIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <polyline points="3 17 9 11 13 15 21 6" />
      <polyline points="15 6 21 6 21 12" />
    </svg>
  )
}
