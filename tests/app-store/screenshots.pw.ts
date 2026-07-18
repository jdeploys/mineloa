import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const outputDirectory = resolve('docs', 'app-store', 'screenshots')

test.beforeAll(async () => mkdir(outputDirectory, { recursive: true }))

async function settle(page: Page) {
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
}

async function open(page: Page, state: string) {
  await page.goto(`/?state=${state}&theme=light`)
  await settle(page)
}

async function capture(page: Page, name: string) {
  await page.screenshot({
    path: resolve(outputDirectory, name),
    animations: 'disabled',
    fullPage: false,
    omitBackground: false,
  })
}

test('captures the App Store product-page set', async ({ page }) => {
  await open(page, 'idle')
  await expect(page.getByRole('heading', { name: '새 회의' })).toBeVisible()
  await capture(page, '01-dashboard.png')

  await open(page, 'active')
  await page.getByRole('button', { name: '녹음 시작' }).click()
  await expect(page.getByText('녹음 중', { exact: true })).toBeVisible()
  await capture(page, '02-recording.png')

  await open(page, 'completed')
  await page.getByRole('button', { name: /제품 방향성 회의/ }).click()
  await expect(page.getByRole('heading', { name: '제품 방향성 회의' })).toBeVisible()
  await capture(page, '03-meeting-detail.png')

  await open(page, 'templates')
  await page.getByRole('button', { name: '요약 템플릿' }).click()
  await expect(page.getByRole('heading', { name: '요약 템플릿', exact: true })).toBeVisible()
  await capture(page, '04-templates.png')

  await open(page, 'settings')
  await page.getByRole('button', { name: '설정', exact: true }).click()
  await expect(page.getByRole('heading', { name: '설정', exact: true })).toBeVisible()
  await capture(page, '05-settings.png')
})
