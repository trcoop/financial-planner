/** @type {import('stylelint').Config} */
export default {
  extends: 'stylelint-config-standard',
  plugins: ['stylelint-declaration-strict-value'],
  rules: {
    // CSS Modules classes in this repo are deliberately camelCase (matches the JS-side
    // `styles.topBar` property access) — not the kebab-case config-standard defaults to.
    'selector-class-pattern': null,
  },
  overrides: [
    {
      files: ['src/ui/**/*.module.css'],
      rules: {
        // Bans hardcoded colors outside theme.css tokens (Component Library spec, "Stylelint
        // rule (the ratchet)"). `stylelint-declaration-strict-value` already treats var(--x) —
        // including var(--x, <fallback>) — as compliant without any extra config, so bare hex/
        // rgb/hsl literals are what get caught; a var() referencing a token that doesn't exist
        // (e.g. the PercentileLineChart `--color-background` bug the spec flags) still isn't
        // caught here by design — that's a cleanup-phase fix, not a lint-rule job.
        //
        // `box-shadow` is deliberately NOT in this list even though the spec's property list
        // names it. This plugin validates every space-separated token in a compound value
        // independently, so the app's own "shadow-as-border" pattern —
        // `box-shadow: inset 0 0 0 1px var(--color-primary)` (Button, PercentileLineChart,
        // ConfirmDialog's dialog, ...) — fails on the literal `inset`/`0`/`1px` offset tokens
        // even though the color portion already is a token. That pattern is the deliberate,
        // already-correct fix from FIN-101 (see Button.module.css's comments), so linting
        // box-shadow here would break already-compliant files the moment anyone touches them —
        // the opposite of what a ratchet should do. Flagged in the FIN-122 PR/ticket for
        // visibility; box-shadow token compliance stays a manual-review concern for the
        // audit (FIN-123) rather than an automated one.
        'scale-unlimited/declaration-strict-value': [
          ['color', 'background', 'background-color', 'border-color'],
          {
            // Functions are allowed by default (this plugin's `ignoreFunctions` default),
            // which would let `rgba(16, 24, 40, 0.48)` (ConfirmDialog's modal scrim — the
            // spec's own flagship example) straight through. Disabling it closes that gap;
            // var()/custom-property usage is tracked separately via `ignoreVariables`
            // (default true) and stays exempt either way.
            ignoreFunctions: false,
            ignoreValues: ['transparent', 'currentColor', 'inherit', 'none'],
            message: 'Use a theme.css token (var(--...)) instead of a hardcoded value for ${property}.',
          },
        ],
      },
    },
  ],
}
