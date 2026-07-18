import { expect, test, type Page } from '@playwright/test'

test.skip(
  process.platform !== 'win32',
  `Processing settings snapshots are supported on Windows; ${process.platform} is unsupported.`,
)

type FixtureTheme = 'light' | 'dark'

async function open(page: Page, state: string, expanded: boolean, theme: FixtureTheme = 'light') {
  await page.goto(`/?state=${state}&theme=${theme}`)
  await page.getByRole('button', { name: '설정', exact: true }).click()
  await expect(page.getByRole('heading', { name: '설정', exact: true })).toBeInViewport()
  expect(await page.evaluate(() => scrollY)).toBe(0)
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme)

  const apiCard = page.getByRole('region', { name: 'API 키 설정' })
  await expect(apiCard).toContainText('저장된 API 키 삭제')
  await expect(apiCard.getByText('설정됨', { exact: true })).toBeVisible()
  await expect(apiCard.getByLabel('OpenAI API 키')).toBeVisible()
  await page.getByLabel('텍스트 변환 방식').waitFor({ state: 'attached' })
  if (expanded) await page.getByText('고급 처리 옵션', { exact: true }).click()
  const markers: Record<string, string> = {
    'provider-defaults': 'OpenAI API · OpenAI API',
    'provider-advanced': 'OpenAI API 키를 사용하며 화자 분리를 지원합니다.',
    'whisper-downloading': '다운로드 중',
    'whisper-installed': 'base 모델 삭제',
    'codex-available': 'Codex CLI가 설치되고 인증되어 사용할 수 있습니다.',
    'codex-unavailable': 'Codex CLI 설정이 올바르지 않습니다. 터미널에서 설정을 확인한 뒤 다시 시도하세요.',
  }
  await expect(page.getByText(markers[state], { exact: true }).first()).toBeVisible()
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
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
  await page.waitForTimeout(150)
}

async function themeControlGeometry(page: Page) {
  return page.locator('.theme-options > label').evaluateAll((labels) => labels.map((label) => {
    const radio = label.querySelector('input[type="radio"]')
    const text = [...label.childNodes].find((node) => node.nodeType === Node.TEXT_NODE)

    if (!(radio instanceof HTMLInputElement) || text === undefined) {
      throw new Error('Theme option must contain a radio and its visible label text')
    }

    const radioRect = radio.getBoundingClientRect()
    const textRange = document.createRange()
    textRange.selectNodeContents(text)
    const textRect = textRange.getBoundingClientRect()
    const labelRect = label.getBoundingClientRect()

    return {
      radioWidth: radioRect.width,
      radioHeight: radioRect.height,
      radioRight: radioRect.right,
      radioCenterY: radioRect.top + radioRect.height / 2,
      textLeft: textRect.left,
      textCenterY: textRect.top + textRect.height / 2,
      labelHeight: labelRect.height,
    }
  }))
}

async function apiKeyControlGeometry(page: Page) {
  return page.getByLabel('OpenAI API 키').evaluate((input) => {
    const form = input.closest('form')
    if (!(input instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) {
      throw new Error('API-key text input must remain inside its settings form')
    }

    const inputRect = input.getBoundingClientRect()
    const formRect = form.getBoundingClientRect()
    const styles = getComputedStyle(input)

    return {
      inputWidth: inputRect.width,
      inputHeight: inputRect.height,
      formWidth: formRect.width,
      inputLeft: inputRect.left,
      formLeft: formRect.left,
      minHeight: styles.minHeight,
      padding: styles.padding,
    }
  })
}

async function expectPaintableSettingsIcon(page: Page, heading: string) {
  const icon = page.getByRole('heading', { name: heading, exact: true }).locator('.ui-icon')
  await expect(icon).toBeVisible()
  const geometry = await icon.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { width: rect.width, height: rect.height }
  })
  expect(geometry.width).toBeGreaterThanOrEqual(16)
  expect(geometry.width).toBeLessThanOrEqual(20)
  expect(geometry.height).toBeGreaterThanOrEqual(16)
  expect(geometry.height).toBeLessThanOrEqual(20)
}

for (const [state, snapshot, expanded] of [
  ['provider-defaults', 'processing-providers-defaults.png', false],
  ['provider-advanced', 'processing-providers-advanced.png', true],
  ['whisper-downloading', 'processing-whisper-downloading.png', true],
  ['codex-unavailable', 'processing-codex-unavailable.png', true],
] as const) {
  test(`real settings route visibly shows ${state}`, async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 })
    await open(page, state, expanded)
    await page.locator('.processing-settings').scrollIntoViewIfNeeded()
    await expect(page).toHaveScreenshot(snapshot, { animations: 'disabled', fullPage: false, omitBackground: false })
  })
}

for (const theme of ['light', 'dark'] as const) {
  test(`real settings ${theme} route keeps its heading and theme action in the 1200x800 viewport`, async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 })
    await open(page, 'provider-defaults', false, theme)
    await page.evaluate(() => scrollTo({ top: 0, left: 0, behavior: 'auto' }))
    await expect(page.getByRole('heading', { name: '설정', exact: true })).toBeInViewport()
    await expectPaintableSettingsIcon(page, '화면 테마')
    await expectPaintableSettingsIcon(page, 'API 키 설정')
    await expect(page.getByRole('radio', { name: theme === 'light' ? '라이트' : '다크' })).toBeInViewport()
    await expect(page).toHaveScreenshot(`settings-${theme}.png`, { animations: 'disabled', fullPage: false, omitBackground: false })
  })
}

for (const [theme, width] of [['light', 1200], ['dark', 640]] as const) {
    test(`real settings ${theme} keeps controls aligned at ${width}x800`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await open(page, 'provider-advanced', true, theme)

      const geometry = await themeControlGeometry(page)
      expect(geometry).toHaveLength(3)
      for (const option of geometry) {
        expect(option.radioWidth).toBeGreaterThanOrEqual(16)
        expect(option.radioWidth).toBeLessThanOrEqual(20)
        expect(option.radioHeight).toBeGreaterThanOrEqual(16)
        expect(option.radioHeight).toBeLessThanOrEqual(20)
        expect(option.labelHeight).toBeLessThanOrEqual(24)
        expect(Math.abs(option.radioCenterY - option.textCenterY)).toBeLessThanOrEqual(1)
        expect(option.textLeft - option.radioRight).toBeGreaterThanOrEqual(7)
        expect(option.textLeft - option.radioRight).toBeLessThanOrEqual(9)
      }

      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await expect(page.getByText('시스템 설정은 Windows 또는 macOS의 화면 모드를 자동으로 따릅니다.')).toBeVisible()

      const apiKeyGeometry = await apiKeyControlGeometry(page)
      expect(apiKeyGeometry.inputWidth).toBeGreaterThan(300)
      expect(apiKeyGeometry.inputWidth).toBeGreaterThanOrEqual(apiKeyGeometry.formWidth * 0.7)
      expect(apiKeyGeometry.inputHeight).toBe(48)
      expect(apiKeyGeometry.inputLeft).toBe(apiKeyGeometry.formLeft)
      expect(apiKeyGeometry.minHeight).toBe('48px')
      expect(apiKeyGeometry.padding).toBe('12px')
    })
}

test('expanded real settings route has no horizontal overflow at 640x800', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 800 })
    await open(page, 'whisper-installed', true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.getByLabel('로컬 모델')).toBeVisible()
})
