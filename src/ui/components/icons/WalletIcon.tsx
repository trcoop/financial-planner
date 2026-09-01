interface IconProps {
  className?: string
}

/**
 * Wallet glyph used for the Profile "Accounts" nav item (FIN-115). Inline SVG only — no icon
 * font, npm icon package, or CDN reference, per the app's zero-network-calls constraint.
 */
export function WalletIcon({ className }: IconProps) {
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
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h13A1.5 1.5 0 0 1 19 7.5V9H3V7.5Z" />
      <path d="M3 9v9a1.5 1.5 0 0 0 1.5 1.5h15A1.5 1.5 0 0 0 21 18V9.5A1.5 1.5 0 0 0 19.5 8H4.5A1.5 1.5 0 0 1 3 6.5" />
      <circle cx="17" cy="14" r="1.25" />
    </svg>
  )
}
