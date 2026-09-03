import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Story IDs come from the meta.json that `ladle build` writes (see playwright.config.ts's
// webServer command) — one screenshot per story, in Ladle's chromeless "preview" mode so the
// shot is just the component, not the story-nav UI around it.
type LadleMeta = { stories: Record<string, { name: string; levels: string[] }> }

const meta: LadleMeta = JSON.parse(
  readFileSync(join(process.cwd(), '.ladle-build', 'meta.json'), 'utf-8'),
)
const storyIds = Object.keys(meta.stories).sort()

for (const id of storyIds) {
  test(`story: ${id}`, async ({ page }) => {
    await page.goto(`/?story=${id}&mode=preview`)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveScreenshot(`${id}.png`)
  })
}
