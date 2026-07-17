import { expect, test, type Page } from '@playwright/test'
import { hasTask10VisualBaseline } from './platformSupport'

test.skip(
  !hasTask10VisualBaseline(process.platform),
  `Task 10 visual comparisons support Windows and macOS, not ${process.platform}.`,
)

type FixtureTheme = 'light' | 'dark'

async function settle(page: Page) {
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await page.waitForTimeout(150)
}

async function openRoute(page: Page, state: string, theme: FixtureTheme = 'light') {
  await page.goto(`/?state=${state}&theme=${theme}`)

  if (state === 'active') await page.getByRole('button', { name: '녹음 시작' }).click()
  if (state === 'completed') await page.getByRole('button', { name: /제품 방향성 회의/ }).click()
  if (state.startsWith('templates')) await page.getByRole('button', { name: '요약 템플릿' }).click()
  if (state === 'settings' || state.startsWith('provider-') || state.startsWith('whisper-') || state.startsWith('codex-')) {
    await page.getByRole('button', { name: '설정', exact: true }).click()
  }

  await settle(page)
  expect(await page.evaluate(() => scrollY)).toBe(0)
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme)
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}

async function expectControlLabelUnclipped(page: Page, label: string) {
  const control = page.getByRole('button', { name: label })
  await control.scrollIntoViewIfNeeded()
  await expect(control).toBeInViewport()
  expect(await control.evaluate((element) => ({
    horizontal: element.scrollWidth <= element.clientWidth,
    vertical: element.scrollHeight <= element.clientHeight,
  }))).toEqual({ horizontal: true, vertical: true })
}

async function expectFirstPairOrientation(page: Page, selector: string, orientation: 'row' | 'column') {
  const items = page.locator(selector)
  await expect(items.first()).toBeVisible()
  await expect(items.nth(1)).toBeVisible()

  const pair = await items.evaluateAll((elements) => elements.slice(0, 2).map((element) => {
    const rect = element.getBoundingClientRect()
    return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left }
  }))
  const [first, second] = pair
  if (first === undefined || second === undefined) throw new Error(`Expected two visible elements for ${selector}`)

  if (orientation === 'column') {
    expect(second.top).toBeGreaterThanOrEqual(first.bottom - 1)
    expect(Math.abs(second.left - first.left)).toBeLessThanOrEqual(1)
    return
  }

  expect(Math.abs(second.top - first.top)).toBeLessThanOrEqual(1)
  expect(second.left).toBeGreaterThanOrEqual(first.right - 1)
}

async function expectNavigationTreatment(page: Page, compact: boolean) {
  const geometry = await page.locator('.topbar').evaluate((topbar) => {
    const nav = topbar.querySelector<HTMLElement>('.app-nav')
    const button = nav?.querySelector<HTMLElement>('button')
    if (nav === null || nav === undefined || button === null || button === undefined) {
      throw new Error('AppShell navigation must render inside the topbar')
    }

    return {
      position: getComputedStyle(topbar).position,
      navWrap: getComputedStyle(nav).flexWrap,
      buttonMinHeight: getComputedStyle(button).minHeight,
      buttonHeight: button.getBoundingClientRect().height,
    }
  })

  if (compact) {
    expect(geometry).toMatchObject({ position: 'static', navWrap: 'wrap', buttonMinHeight: '36px' })
    expect(geometry.buttonHeight).toBeLessThanOrEqual(40)
    return
  }

  expect(geometry).toMatchObject({ position: 'sticky', navWrap: 'nowrap', buttonMinHeight: '48px' })
  expect(geometry.buttonHeight).toBeGreaterThanOrEqual(48)
}

async function expectRouteLayouts(page: Page, width: number, compact: boolean) {
  const orientation = compact ? 'column' : 'row'

  await openRoute(page, 'idle')
  await expectNavigationTreatment(page, compact)
  await expectFirstPairOrientation(page, '.dashboard.page-container > section', orientation)
  await expectNoHorizontalOverflow(page)
  await expect(page).toHaveScreenshot(`responsive-${compact ? 'compact' : 'noncompact'}-${width}.png`, {
    animations: 'disabled',
    fullPage: false,
    omitBackground: false,
  })

  await openRoute(page, 'provider-advanced')
  await page.getByText('고급 처리 옵션', { exact: true }).click()
  await expectFirstPairOrientation(page, '.provider-grid > label', orientation)
  await expectNoHorizontalOverflow(page)

  await openRoute(page, 'completed')
  await expectFirstPairOrientation(page, '.transcript-row:first-child > *', orientation)
  await expectNoHorizontalOverflow(page)

  await openRoute(page, 'recovery-dialog')
  await expectFirstPairOrientation(page, '.recovery-metrics:first-of-type > div', orientation)
  await expectNoHorizontalOverflow(page)
}

test('real dashboard light route keeps its heading and primary action in the 1200x800 viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  await openRoute(page, 'idle', 'light')
  await expect(page.getByRole('heading', { name: '새 회의' })).toBeInViewport()
  await expect(page.getByRole('button', { name: '녹음 시작' })).toBeInViewport()
  await expect(page).toHaveScreenshot('dashboard-idle-light.png', { animations: 'disabled', fullPage: false, omitBackground: false })
})

test('real dashboard dark route uses the warm-charcoal theme in the 1200x800 viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  await openRoute(page, 'idle', 'dark')
  await expect(page.getByRole('heading', { name: '새 회의' })).toBeInViewport()
  await expect(page.getByRole('button', { name: '녹음 시작' })).toBeInViewport()
  await expect(page).toHaveScreenshot('dashboard-idle-dark.png', { animations: 'disabled', fullPage: false, omitBackground: false })
})

test('dashboard recording start remains button-driven through the real App', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  await openRoute(page, 'active')
  await expect(page.getByText('녹음 중', { exact: true })).toBeInViewport()
  await expect(page.getByRole('button', { name: '종료', exact: true })).toBeInViewport()
  await expect(page).toHaveScreenshot('dashboard-active.png', { animations: 'disabled', fullPage: false, omitBackground: false })
})

test('meeting detail opens from the real meeting row and preserves a full-document baseline', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  await openRoute(page, 'completed')
  await expect(page.getByRole('heading', { name: '제품 방향성 회의' })).toBeInViewport()
  await expect(page).toHaveScreenshot('meeting-detail-completed.png', { animations: 'disabled', fullPage: true, omitBackground: false })
})

for (const [state, snapshot] of [
  ['failed', 'dashboard-failed.png'],
  ['recoverable', 'dashboard-recoverable.png'],
] as const) {
  test(`real dashboard route visibly shows ${state} processing`, async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 })
    await openRoute(page, state)
    await expect(page.getByRole('heading', { name: '새 회의' })).toBeInViewport()
    await expect(page).toHaveScreenshot(snapshot, { animations: 'disabled', fullPage: false, omitBackground: false })
  })
}

test('real template route resets scroll and keeps its heading and save action in the 1200x800 viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  await openRoute(page, 'templates')
  await expect(page.getByRole('heading', { name: '요약 템플릿', exact: true })).toBeInViewport()
  await page.getByRole('button', { name: '새 템플릿' }).click()
  await expect(page.getByLabel('템플릿 이름')).toHaveValue('새 템플릿')
  await expect(page.getByRole('button', { name: '템플릿 저장' })).toBeInViewport()
  await expect(page).toHaveScreenshot('templates-light.png', { animations: 'disabled', fullPage: false, omitBackground: false })
})

for (const width of [1200, 640]) {
  test(`real pending operation labels remain unclipped without overflow at ${width}x800`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    for (const operation of [
      { state: 'templates-create-pending', trigger: () => page.getByRole('button', { name: '새 템플릿' }), label: '생성 중…' },
      { state: 'templates-save-pending', trigger: () => page.getByRole('button', { name: '템플릿 저장' }), label: '저장 중…' },
      { state: 'templates-reorder-pending', trigger: () => page.getByRole('button', { name: '위로 이동' }).nth(1), label: '정렬 중…' },
      { state: 'templates-delete-pending', trigger: () => page.getByRole('button', { name: '템플릿 삭제' }), label: '삭제 중…' },
    ]) {
      await openRoute(page, operation.state)
      await operation.trigger().click()
      await expect(page.getByRole('region', { name: '요약 템플릿' })).toHaveAttribute('aria-busy', 'true')
      await expectControlLabelUnclipped(page, operation.label)
      await expectNoHorizontalOverflow(page)
    }

    await openRoute(page, 'codex-refresh-pending')
    await page.getByText('고급 처리 옵션', { exact: true }).click()
    await page.getByRole('button', { name: 'Codex CLI 상태 다시 확인' }).click()
    await expect(page.getByRole('region', { name: 'Codex CLI 상태' })).toHaveAttribute('aria-busy', 'true')
    await expectControlLabelUnclipped(page, 'Codex CLI 상태 확인 중…')
    await expectNoHorizontalOverflow(page)
  })
}

for (const width of [938, 640]) {
  test(`real dashboard has no horizontal overflow at ${width}x800`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await openRoute(page, 'failed')
    await expectNoHorizontalOverflow(page)
    if (width === 640) {
      await expect(page).toHaveScreenshot('dashboard-narrow-640.png', { animations: 'disabled', fullPage: false, omitBackground: false })
    }
  })
}

for (const width of [721, 743]) {
  test(`real App compact seam at ${width}x800 wraps navigation and stacks dashboard, settings, meeting, and recovery without overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await expectRouteLayouts(page, width, true)
  })
}

for (const width of [744, 938]) {
  test(`real App non-compact seam at ${width}x800 keeps desktop navigation and two-column dashboard, settings, meeting, and recovery`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await expectRouteLayouts(page, width, false)
  })
}
