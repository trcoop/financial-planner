import { defineConfig, devices } from '@playwright/test'

// Visual regression suite: screenshots diffed against committed baselines under
// tests/visual/**/*.spec.ts-snapshots/. See tests/visual/README.md for how to run and update.
//
// stories.spec.ts reads .ladle-build/meta.json at module load time (test-collection time),
// so that file must exist before `playwright test` even starts — the `npm run ladle:build`
// step in this project's `test:visual`/`test:visual:update` scripts (package.json) handles
// that; the webServer below only serves the already-built output via `ladle preview`.
export default defineConfig({
  testDir: 'tests/visual',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.01 },
  },
  use: {
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'stories',
      testMatch: /stories\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:61000' },
    },
    {
      name: 'pages',
      testMatch: /pages\.spec\.ts/,
      // vite.config.ts's `base: '/financial-planner/'` applies to the production build served here.
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:4173/financial-planner/' },
    },
  ],
  webServer: [
    {
      // `npm run ladle:build` (see test:visual/test:visual:update in package.json) already
      // built .ladle-build/ before this runs; this just serves that output.
      command: 'npx ladle preview --port 61000',
      url: 'http://localhost:61000',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'npm run build && npx vite preview --port 4173',
      url: 'http://localhost:4173/financial-planner/',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
