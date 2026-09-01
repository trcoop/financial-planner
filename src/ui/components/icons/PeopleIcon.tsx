interface IconProps {
  className?: string
}

/**
 * Two-person glyph used for the Profile "People" nav item (FIN-115). Inline SVG only — no
 * icon font, npm icon package, or CDN reference, per the app's zero-network-calls constraint.
 */
export function PeopleIcon({ className }: IconProps) {
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
      <path d="M8.5 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
      <path d="M2.5 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M16 6.2c1.4.4 2.5 1.7 2.5 3.3 0 1.6-1.1 2.9-2.5 3.3" />
      <path d="M15 14.2c2.7.5 4.5 2.7 4.5 5.8" />
    </svg>
  )
}
