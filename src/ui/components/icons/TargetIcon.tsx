interface IconProps {
  className?: string
}

/**
 * Target glyph used for the Profile "Retirement Spending" nav item (FIN-135). A reasonable
 * placeholder from the existing icon set — swappable later without a data-contract change, per
 * ERD §11's non-blocking treatment of the nav icon choice. Inline SVG only — no icon font, npm
 * icon package, or CDN reference, per the app's zero-network-calls constraint.
 */
export function TargetIcon({ className }: IconProps) {
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
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </svg>
  )
}
