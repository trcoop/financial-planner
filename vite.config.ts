// `defineConfig` comes from `vitest/config` rather than `vite` so the `test` key below is typed
// without a triple-slash reference directive (which oxlint flags as redundant beside a real
// import). It re-exports Vite's own `defineConfig`, widened with Vitest's options.
import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/financial-planner/',
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    // Vitest's default include descends into dot-directories, so a local run was collecting
    // every sibling agent worktree under `.claude/worktrees/*/src/**` — running ~3 copies of
    // the suite against stale code from other branches, and letting an unrelated branch's red
    // test fail this one's run. CI clones clean so it never saw this; local runs did.
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
})
