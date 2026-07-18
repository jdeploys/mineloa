import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

test.skip(process.platform !== 'win32', 'Documentation screenshots use the reviewed Windows rendering.')
test.use({ viewport: { width: 1200, height: 800 } })

type FixtureTheme = 'light' | 'dark'

const screenshotDirectory = resolve('docs', 'screenshots', 'after-airbnb')
const screenshotNames = [
  '01-dashboard.png',
  '02-recording.png',
  '03-recovery.png',
  '04-processing-failed.png',
  '05-meeting-detail.png',
  '06-template-editor.png',
  '07-api-key-settings.png',
  '08-processing-provider-defaults.png',
  '09-processing-provider-advanced.png',
  '10-whisper-model-downloading.png',
  '11-whisper-model-installed.png',
  '12-codex-cli-available.png',
  '13-codex-cli-unavailable.png',
  '14-theme-light.png',
  '15-theme-dark.png',
  '16-meeting-record-import.png',
  '17-template-header.png',
] as const

type ScreenshotName = typeof screenshotNames[number]

const output = (name: ScreenshotName) => resolve(screenshotDirectory, name)

test.beforeAll(async () => mkdir(screenshotDirectory, { recursive: true }))

async function settle(page: Page) {
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
  await page.waitForTimeout(150)
}

async function openRoute(page: Page, state: string, theme: FixtureTheme = 'light') {
  await page.goto(`/?state=${state}&theme=${theme}`)

  if (state === 'active') await page.getByRole('button', { name: '녹음 시작' }).click()
  if (state === 'completed') await page.getByRole('button', { name: /제품 방향성 회의/ }).click()
  if (state === 'templates') await page.getByRole('button', { name: '요약 템플릿' }).click()
  if (state === 'settings' || state.startsWith('provider-') || state.startsWith('whisper-') || state.startsWith('codex-')) {
    await page.getByRole('button', { name: '설정', exact: true }).click()
  }

  await settle(page)
  expect(await page.evaluate(() => scrollY)).toBe(0)
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme)
}

async function captureRoute(
  page: Page,
  state: string,
  name: ScreenshotName,
  heading: string,
  options: { fullPage?: boolean, theme?: FixtureTheme } = {},
) {
  await openRoute(page, state, options.theme)
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({
    path: output(name),
    animations: 'disabled',
    fullPage: options.fullPage ?? false,
    omitBackground: false,
  })
}

async function waitForStableSettings(page: Page, marker: string, expanded: boolean) {
  await expect(page.getByRole('heading', { name: '설정', exact: true })).toBeInViewport()
  const apiCard = page.getByRole('region', { name: 'API 키 설정' })
  await expect(apiCard).toContainText('저장된 API 키 삭제')
  await expect(apiCard.getByText('설정됨', { exact: true })).toBeVisible()
  await expect(apiCard.getByLabel('OpenAI API 키')).toBeVisible()
  await page.getByLabel('텍스트 변환 방식').waitFor({ state: 'attached' })
  if (expanded) await page.getByText('고급 처리 옵션', { exact: true }).click()
  await expect(page.getByText(marker, { exact: true }).first()).toBeVisible()
  if (expanded) {
    await expect(page.getByLabel('텍스트 변환 방식')).toBeVisible()
    await expect(page.getByLabel('요약 방식')).toBeVisible()
  }
  await expect.poll(() => page.evaluate(({ expanded }) => {
    const api = document.querySelector<HTMLElement>('.settings-panel')
    const processing = document.querySelector<HTMLElement>('.processing-settings')
    const selectors = [...document.querySelectorAll<HTMLElement>('.provider-grid select')]
    const hasPaintableBox = (element: HTMLElement | null) => element !== null
      && element.getBoundingClientRect().width > 100
      && element.getBoundingClientRect().height > 30
    return hasPaintableBox(api)
      && hasPaintableBox(processing)
      && (api?.innerText.includes('API 키 설정') ?? false)
      && (api?.innerText.includes('저장된 API 키 삭제') ?? false)
      && (!expanded || (selectors.length >= 2 && selectors.every(hasPaintableBox)))
  }, { expanded })).toBe(true)
  await settle(page)
}

async function alignBelowStickyHeader(page: Page, selector: string) {
  await page.locator(selector).evaluate((element) => {
    const headerBottom = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0
    const top = element.getBoundingClientRect().top + scrollY - headerBottom - 24
    scrollTo({ top, left: 0, behavior: 'auto' })
  })
  await settle(page)
}

async function avoidStickyHeaderTextClipping(page: Page) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const adjustment = await page.evaluate(() => {
      const headerBottom = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0
      const overlapping = [...document.querySelectorAll<HTMLElement>('main h1, main h2, main h3, main strong, main label, main p')]
        .find((element) => {
          const rect = element.getBoundingClientRect()
          return rect.top < headerBottom && rect.bottom > headerBottom
        })
      return overlapping === undefined ? 0 : headerBottom + 24 - overlapping.getBoundingClientRect().top
    })
    if (adjustment <= 0) return
    await page.evaluate((offset) => scrollBy({ top: -offset, left: 0, behavior: 'auto' }), adjustment)
    await settle(page)
  }
}

async function expectFullyInViewport(page: Page, selector: string) {
  const geometry = await page.locator(selector).evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left }
  })
  expect(geometry.top).toBeGreaterThanOrEqual(0)
  expect(geometry.left).toBeGreaterThanOrEqual(0)
  expect(geometry.right).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
  expect(geometry.bottom).toBeLessThanOrEqual(await page.evaluate(() => innerHeight))
}

async function expectNoStickyHeaderTextClipping(page: Page) {
  const overlap = await page.evaluate(() => {
    const headerBottom = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0
    return [...document.querySelectorAll<HTMLElement>('main h1, main h2, main h3, main strong, main label, main p')]
      .filter((element) => {
        const rect = element.getBoundingClientRect()
        return rect.top < headerBottom && rect.bottom > headerBottom
      })
      .map((element) => element.innerText.trim())
  })
  expect(overlap).toEqual([])
}

async function captureSettingsState(
  page: Page,
  state: string,
  name: ScreenshotName,
  marker: string,
  expanded: boolean,
  focusSelector: string,
  alignTop = false,
) {
  await openRoute(page, state)
  await waitForStableSettings(page, marker, expanded)
  if (alignTop) await alignBelowStickyHeader(page, focusSelector)
  else {
    await page.locator(focusSelector).scrollIntoViewIfNeeded()
    await settle(page)
  }
  await avoidStickyHeaderTextClipping(page)
  await expect(page.getByText(marker, { exact: true }).first()).toBeInViewport()
  await expectNoStickyHeaderTextClipping(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: output(name), animations: 'disabled', fullPage: false, omitBackground: false })
}

async function captureTheme(page: Page, theme: FixtureTheme, name: ScreenshotName) {
  await openRoute(page, 'settings', theme)
  await waitForStableSettings(page, 'OpenAI API · OpenAI API', false)
  await page.evaluate(() => scrollTo({ top: 0, left: 0, behavior: 'auto' }))
  await settle(page)

  await expect(page.getByRole('heading', { name: '설정', exact: true })).toBeInViewport()
  await expect(page.getByRole('heading', { name: '화면 테마', exact: true })).toBeInViewport()
  await expect(page.getByRole('radio', { name: theme === 'light' ? '라이트' : '다크' })).toBeChecked()
  const radioGeometry = await page.locator('.theme-options input[type="radio"]').evaluateAll((radios) => radios.map((radio) => {
    const rect = radio.getBoundingClientRect()
    return { width: rect.width, height: rect.height }
  }))
  expect(radioGeometry).toHaveLength(3)
  for (const radio of radioGeometry) {
    expect(radio.width).toBeGreaterThanOrEqual(16)
    expect(radio.width).toBeLessThanOrEqual(20)
    expect(radio.height).toBeGreaterThanOrEqual(16)
    expect(radio.height).toBeLessThanOrEqual(20)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: output(name), animations: 'disabled', fullPage: false, omitBackground: false })
}

test('documents the empty dashboard through the real App route', async ({ page }) => {
  await captureRoute(page, 'idle', '01-dashboard.png', '새 회의')
  await expect(page.getByRole('button', { name: '녹음 시작' })).toBeInViewport()
})

test('documents active local recording through the real start action', async ({ page }) => {
  await openRoute(page, 'active')
  await expect(page.getByText('녹음 중', { exact: true })).toBeInViewport()
  await expect(page.getByRole('button', { name: '종료', exact: true })).toBeInViewport()
  await page.screenshot({ path: output('02-recording.png'), animations: 'disabled', fullPage: false, omitBackground: false })
})

test('documents crash recovery through the real dashboard route', async ({ page }) => {
  await captureRoute(page, 'recoverable', '03-recovery.png', '새 회의')
  await expect(page.getByRole('button', { name: /중단된 고객 인터뷰/ })).toBeInViewport()
})

test('documents a failed processing state through the real dashboard route', async ({ page }) => {
  await captureRoute(page, 'failed', '04-processing-failed.png', '새 회의')
  await expect(page.getByRole('button', { name: /주간 운영 회의/ })).toBeInViewport()
})

test('documents the completed meeting workspace opened from its real meeting row', async ({ page }) => {
  await captureRoute(page, 'completed', '05-meeting-detail.png', '제품 방향성 회의', { fullPage: true })
})

test('documents summary template editing through the real template route', async ({ page }) => {
  await openRoute(page, 'templates')
  await expect(page.getByRole('heading', { name: '요약 템플릿', exact: true })).toBeInViewport()
  await page.getByRole('button', { name: '새 템플릿' }).click()
  await expect(page.getByLabel('템플릿 이름')).toHaveValue('새 템플릿')
  await page.evaluate(() => scrollTo({ top: 120, left: 0, behavior: 'auto' }))
  await settle(page)
  await expect(page.getByRole('heading', { name: '템플릿 편집', exact: true })).toBeInViewport()
  await expect(page.getByRole('button', { name: '템플릿 저장' })).toBeInViewport()
  await expectFullyInViewport(page, '.template-editor')
  await avoidStickyHeaderTextClipping(page)
  await expectNoStickyHeaderTextClipping(page)
  await page.screenshot({ path: output('06-template-editor.png'), animations: 'disabled', fullPage: false, omitBackground: false })
})

test('documents local API key settings through the real settings route', async ({ page }) => {
  await openRoute(page, 'settings')
  await waitForStableSettings(page, 'OpenAI API · OpenAI API', false)
  await alignBelowStickyHeader(page, '.settings-panel')
  await expect(page.getByRole('heading', { name: 'API 키 설정', exact: true })).toBeInViewport()
  await expect(page.getByLabel('OpenAI API 키')).toBeInViewport()
  await expect(page.getByRole('button', { name: 'API 키 삭제' })).toBeInViewport()
  await page.screenshot({ path: output('07-api-key-settings.png'), animations: 'disabled', fullPage: false, omitBackground: false })
})

test('documents default processing providers through the real settings route', async ({ page }) => {
  await captureSettingsState(
    page,
    'provider-defaults',
    '08-processing-provider-defaults.png',
    'OpenAI API · OpenAI API',
    false,
    '.processing-settings',
  )
})

test('documents expanded processing providers through the real settings route', async ({ page }) => {
  await captureSettingsState(
    page,
    'provider-advanced',
    '09-processing-provider-advanced.png',
    'OpenAI API 키를 사용하며 화자 분리를 지원합니다.',
    true,
    '.advanced-settings',
    true,
  )
})

for (const [state, name, marker, focusSelector] of [
  ['whisper-downloading', '10-whisper-model-downloading.png', '다운로드 중', '.model-status'],
  ['whisper-installed', '11-whisper-model-installed.png', 'base 모델 삭제', '.model-status'],
  ['codex-available', '12-codex-cli-available.png', 'Codex CLI가 설치되고 인증되어 사용할 수 있습니다.', '.cli-status'],
  ['codex-unavailable', '13-codex-cli-unavailable.png', 'Codex CLI 설정이 올바르지 않습니다. 터미널에서 설정을 확인한 뒤 다시 시도하세요.', '.cli-status'],
] as const) {
  test(`documents ${state} through the real settings route`, async ({ page }) => {
    await captureSettingsState(page, state, name, marker, true, focusSelector, true)
  })
}

test('documents corrected light theme controls through the real settings route', async ({ page }) => {
  await captureTheme(page, 'light', '14-theme-light.png')
})

test('documents corrected dark theme controls through the real settings route', async ({ page }) => {
  await captureTheme(page, 'dark', '15-theme-dark.png')
})

test('documents meeting record import through the real settings route', async ({ page }) => {
  await openRoute(page, 'settings')
  await waitForStableSettings(page, 'OpenAI API · OpenAI API', false)
  const recordSettings = page.getByRole('region', { name: '회의 기록 관리' })
  await expect(recordSettings.getByRole('button', { name: '회의 기록 가져오기' })).toBeVisible()
  await recordSettings.screenshot({ path: output('16-meeting-record-import.png'), animations: 'disabled', omitBackground: false })
})

test('documents the aligned template page header', async ({ page }) => {
  await openRoute(page, 'templates')
  const back = page.locator('.page-header .back-button')
  const heading = page.getByRole('heading', { name: '요약 템플릿', exact: true })
  await expect(back).toBeInViewport()
  await expect(heading).toBeInViewport()
  await page.screenshot({ path: output('17-template-header.png'), animations: 'disabled', fullPage: false, omitBackground: false })
})
