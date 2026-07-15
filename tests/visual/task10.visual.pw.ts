import { expect, test, type Page } from '@playwright/test'
import { hasTask10VisualBaseline } from './platformSupport'

test.skip(
  !hasTask10VisualBaseline(process.platform),
  `Task 10 visual comparisons support Windows and macOS, not ${process.platform}.`,
)

async function capture(page: Page, state: string, name: string) {
  await page.goto(`/?state=${state}`)
  if (state === 'active') await page.getByRole('button', { name: '녹음 시작' }).click()
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await page.waitForTimeout(150)
  await expect(page).toHaveScreenshot(name, { animations: 'disabled', fullPage: true, omitBackground: false })
}

test('dashboard-shows-idle-recording-and-empty-library', async ({ page }) => capture(page, 'idle', 'dashboard-idle.png'))
test('dashboard-shows-active-recording-controls', async ({ page }) => capture(page, 'active', 'dashboard-active.png'))
test('meeting-detail-shows-completed-document', async ({ page }) => capture(page, 'completed', 'meeting-detail-completed.png'))
test('dashboard-shows-failed-processing', async ({ page }) => capture(page, 'failed', 'dashboard-failed.png'))
test('dashboard-shows-recoverable-recording', async ({ page }) => capture(page, 'recoverable', 'dashboard-recoverable.png'))
test('dashboard-stacks-at-supported-narrow-width', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 })
  await capture(page, 'failed', 'dashboard-narrow-640.png')
})
