interface IconProps {
  className?: string
}

/**
 * Calculator glyph (rounded body, display bar, 2x2 button grid) used for the
 * Calculators nav item (LeftNav desktop and BottomTabBar mobile). Matches the
 * Direction B mockup's icon exactly (not a generic grid — see FIN-90 round 2:
 * the mockup's Calculators icon is a calculator, distinct from GridIcon's 2x2
 * squares glyph). Inline SVG only — no icon font, npm icon package, or CDN
 * reference, per the app's zero-network-calls constraint.
 */
export function CalculatorIcon({ className }: IconProps) {
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
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <line x1="8" y1="7" x2="16" y2="7" />
      <line x1="8" y1="11" x2="10" y2="11" />
      <line x1="13" y1="11" x2="15" y2="11" />
      <line x1="8" y1="15" x2="10" y2="15" />
      <line x1="13" y1="15" x2="15" y2="15" />
    </svg>
  )
}
