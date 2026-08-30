interface IconProps {
  className?: string
}

/**
 * Line-chart-with-axes glyph used for the Plan nav item (LeftNav desktop and
 * BottomTabBar mobile). Path data matches the Direction B mockup exactly (an
 * axis L plus a jagged trend line) — updated FIN-90 round 2 after visual
 * review found the previous arrow-only glyph didn't match the mockup's
 * iconography. Inline SVG only — no icon font, npm icon package, or CDN
 * reference, per the app's zero-network-calls constraint.
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
      <path d="M3 3v18h18" />
      <path d="M18.7 8 12 14.7 8.7 11.4 3 17" />
    </svg>
  )
}
