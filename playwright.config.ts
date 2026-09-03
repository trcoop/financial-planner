import { defineConfig, devices } from '@playwright/test'

// Visual regression suite: screenshots diffed against committed baselines under
// tests/visual/**/*.spec.ts-snapshots/. See tests/visual/README.md for how to run and update.
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
      command: 'npm run ladle:build && npx ladle preview --port 61000',
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
