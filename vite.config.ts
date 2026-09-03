// `defineConfig` comes from `vitest/config` rather than `vite` so the `test` key below is typed
// without a triple-slash reference directive (which oxlint flags as redundant beside a real
// import). It re-exports Vite's own `defineConfig`, widened with Vitest's options.
import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Ladle's dev/build CLI (`npm run ladle`) auto-loads this file and merges its plugins into
// Ladle's own bundled Vite 6 pipeline (see get-user-vite-config.js), regardless of whether
// Ladle's config points at it explicitly. @vitejs/plugin-react here targets this project's
// Vite 8/rolldown build and produces a rolldown-shaped plugin object that Vite 6's plugin
// container can't run ("Missing field `moduleType`" from the react-refresh wrapper) - so when
// running under Ladle (it sets VITE_LADLE_APP_ID before loading this config), skip this plugin
// entirely and let Ladle supply its own Vite-6-compatible one instead.
const isLadle = Boolean(process.env.VITE_LADLE_APP_ID)

// https://vite.dev/config/
export default defineConfig({
  plugins: isLadle ? [] : [react()],
  base: '/financial-planner/',
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    // Vitest's default include descends into dot-directories, so a local run was collecting
    // every sibling agent worktree under `.claude/worktrees/*/src/**` — running ~3 copies of
    // the suite against stale code from other branches, and letting an unrelated branch's red
    // test fail this one's run. CI clones clean so it never saw this; local runs did.
    // tests/visual/**/*.spec.ts are Playwright specs (see playwright.config.ts), not Vitest
    // ones — Vitest's default include would otherwise collect and try to run them itself.
    exclude: [...configDefaults.exclude, '.claude/**', 'tests/visual/**'],
    // Vitest's 5000ms default is too tight for the heaviest Monte Carlo tests (8,000-path
    // trials in calibration.test.ts, monteCarloHandler.test.ts) under CI's slower/loaded
    // runners — they run comfortably under 5s locally but have flaked repeatedly in CI on
    // this exact timeout. Raised globally rather than per-test since the same class of test
    // recurs across files.
    testTimeout: 15000,
  },
})
