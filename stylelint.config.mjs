// Deliberately does NOT `extend: 'stylelint-config-standard'` here, even though the spec's
// "Stylelint rule (the ratchet)" section names it. stylelint-config-standard's full ruleset
// (selector naming, comment spacing, color-function/notation preferences, deprecated
// properties, specificity ordering, ...) has nothing to do with hardcoded colors, and this repo
// has never been linted against it — round-1 review of this ticket proved that extending it
// makes the *changed-files-only* ratchet flag 75 pre-existing, unrelated violations across 15
// files, so touching e.g. TopBar.module.css or LeftNav.module.css for any reason (even a typo
// fix) gets blocked by 27 violations that have nothing to do with this ticket. That's exactly
// what the project's own scoping decision says the ratchet must not do ("without blocking
// in-flight/unrelated stories on pre-existing violations"). `stylelint-config-standard` stays a
// devDependency for FIN-126 (the later repo-wide gate ticket) to pick up if wanted once cleanup
// has landed everywhere — turning it on today is premature.
/** @type {import('stylelint').Config} */
export default {
  plugins: ['stylelint-declaration-strict-value'],
  // No top-level rules: this config exists purely to scope the ratchet rule to
  // src/ui/**/*.module.css below (theme.css and anything outside that glob gets no rules at
  // all right now). Stylelint requires a `rules` key to exist even so, or it refuses to run.
  rules: {},
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
            ignoreValues: [
              'transparent',
              'currentColor',
              'inherit',
              'none',
              // Disabling ignoreFunctions above also catches color-mix() even when it's built
              // entirely from a token, e.g. PercentileLineChart's
              // `color-mix(in srgb, var(--color-bg) 85%, transparent)` — a real false positive,
              // found by re-running the full ratchet after the ignoreFunctions change above.
              // Only exempt a color-mix() call that references a token somewhere inside it, so
              // a fully-hardcoded one (e.g. `color-mix(in srgb, #fff 85%, transparent)`) still
              // gets caught. Doesn't catch a color-mix() that mixes a token with A SECOND
              // hardcoded color in the same call — no reasonable regex distinguishes that from
              // the fully-compliant case, so that narrower case stays a manual-review gap, same
              // as the box-shadow exclusion above.
              '/^color-mix\\(.*var\\(--/',
            ],
            message: 'Use a theme.css token (var(--...)) instead of a hardcoded value for ${property}.',
          },
        ],
      },
    },
  ],
}
