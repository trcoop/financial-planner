import { test, expect } from '@playwright/test'

// Full-page screenshots for the app's two top-level sections (App.tsx's SectionId union) —
// catches page-level layout/composition regressions that isolated component-story shots miss.
// Kept to the two sections' default states, not every input permutation.

test('page: plan section', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await expect(page).toHaveScreenshot('plan-section.png', { fullPage: true })
})

test('page: calculators section', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Calculators' }).click()
  await page.waitForLoadState('networkidle')
  await expect(page).toHaveScreenshot('calculators-section.png', { fullPage: true })
})
