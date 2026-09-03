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
  // LeftNav and BottomTabBar are both always mounted (App.css switches visibility by media
  // query, not conditional render) — scope to .navPane so getByRole doesn't hit both.
  await page.locator('.navPane').getByRole('button', { name: 'Calculators' }).click()
  await page.waitForLoadState('networkidle')
  await expect(page).toHaveScreenshot('calculators-section.png', { fullPage: true })
})
