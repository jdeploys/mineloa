import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const outputDirectory = resolve('docs', 'app-store', 'screenshots')

type ProductShot = {
  name: string
  eyebrow: string
  title: string
  description: string
}

test.beforeAll(async () => mkdir(outputDirectory, { recursive: true }))

async function settle(page: Page) {
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
}

async function open(page: Page, state: string) {
  await page.goto(`/?state=${state}&theme=light`)
  await settle(page)
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

async function captureProductShot(page: Page, shot: ProductShot) {
  const appScreenshot = await page.screenshot({
    animations: 'disabled',
    fullPage: false,
    omitBackground: false,
  })
  const appImage = `data:image/png;base64,${appScreenshot.toString('base64')}`

  await page.setContent(`
    <!doctype html>
    <html lang="ko">
      <head>
        <meta charset="utf-8" />
        <style>
          * { box-sizing: border-box; }
          html, body { margin: 0; width: 1280px; height: 800px; overflow: hidden; }
          body {
            color: #251f21;
            background:
              radial-gradient(circle at 88% 10%, rgba(255, 255, 255, 0.94) 0 8%, transparent 30%),
              linear-gradient(145deg, #fff7f8 0%, #ffe8ee 100%);
            font-family: Inter, Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            -webkit-font-smoothing: antialiased;
          }
          .canvas { position: relative; width: 100%; height: 100%; padding: 42px 72px 0; }
          .brand {
            display: flex;
            align-items: center;
            gap: 10px;
            color: #d90042;
            font-size: 15px;
            font-weight: 800;
            letter-spacing: 0.04em;
          }
          .brand-mark {
            display: grid;
            width: 28px;
            height: 28px;
            place-items: center;
            border-radius: 9px;
            color: #fff;
            background: #f0004d;
            box-shadow: 0 7px 18px rgba(240, 0, 77, 0.2);
            font-size: 13px;
            letter-spacing: -0.08em;
          }
          .copy { position: relative; z-index: 2; margin-top: 13px; }
          .eyebrow {
            margin: 0 0 6px;
            color: #d90042;
            font-size: 14px;
            font-weight: 800;
            letter-spacing: 0.08em;
          }
          h1 {
            margin: 0;
            font-size: 46px;
            line-height: 1.12;
            letter-spacing: -0.045em;
            font-weight: 850;
          }
          .description {
            position: absolute;
            top: 105px;
            right: 74px;
            width: 410px;
            margin: 0;
            color: #665b5e;
            font-size: 18px;
            line-height: 1.55;
            text-align: right;
            word-break: keep-all;
          }
          .window {
            position: absolute;
            z-index: 1;
            top: 226px;
            left: 72px;
            width: 1136px;
            height: 710px;
            overflow: hidden;
            border: 1px solid rgba(100, 62, 73, 0.14);
            border-radius: 22px 22px 0 0;
            background: #fff;
            box-shadow: 0 32px 80px rgba(102, 34, 55, 0.18), 0 6px 22px rgba(102, 34, 55, 0.1);
          }
          .window-bar {
            display: flex;
            height: 34px;
            align-items: center;
            padding: 0 15px;
            gap: 7px;
            border-bottom: 1px solid #eee8ea;
            background: #fbf9fa;
          }
          .dot { width: 10px; height: 10px; border-radius: 999px; }
          .dot-red { background: #ff5f57; }
          .dot-yellow { background: #febc2e; }
          .dot-green { background: #28c840; }
          .app {
            display: block;
            width: 100%;
            height: auto;
          }
        </style>
      </head>
      <body>
        <main class="canvas">
          <div class="brand"><span class="brand-mark">M</span><span>Mineloa</span></div>
          <div class="copy">
            <p class="eyebrow">${escapeHtml(shot.eyebrow)}</p>
            <h1>${escapeHtml(shot.title)}</h1>
          </div>
          <p class="description">${escapeHtml(shot.description)}</p>
          <section class="window" aria-label="Mineloa 앱 화면">
            <div class="window-bar" aria-hidden="true">
              <span class="dot dot-red"></span>
              <span class="dot dot-yellow"></span>
              <span class="dot dot-green"></span>
            </div>
            <img class="app" src="${appImage}" alt="" />
          </section>
        </main>
      </body>
    </html>
  `)
  await page.screenshot({
    path: resolve(outputDirectory, shot.name),
    animations: 'disabled',
    fullPage: false,
    omitBackground: false,
  })
}

test('captures the App Store product-page set', async ({ page }) => {
  await open(page, 'completed')
  await expect(page.getByRole('heading', { name: '새 회의' })).toBeVisible()
  await captureProductShot(page, {
    name: '01-dashboard.png',
    eyebrow: '모든 회의를 한곳에',
    title: '회의를 시작하면, 기록은 한곳에',
    description: '새 녹음을 시작하고 지난 회의 기록까지 한 화면에서 관리하세요.',
  })

  await open(page, 'active')
  await page.getByRole('button', { name: '녹음 시작' }).click()
  await expect(page.getByText('녹음 중', { exact: true })).toBeVisible()
  await captureProductShot(page, {
    name: '02-recording.png',
    eyebrow: '안전한 로컬 녹음',
    title: '중요한 대화에만 집중하세요',
    description: '녹음은 Mineloa가 이 기기에 안전하게 저장합니다.',
  })

  await open(page, 'completed')
  await page.getByRole('button', { name: /제품 방향성 회의/ }).click()
  await expect(page.getByRole('heading', { name: '제품 방향성 회의' })).toBeVisible()
  await page.getByRole('heading', { name: '핵심 요약' }).evaluate((heading) => {
    heading.scrollIntoView({ block: 'start' })
    window.scrollBy(0, -60)
  })
  await settle(page)
  await captureProductShot(page, {
    name: '03-meeting-detail.png',
    eyebrow: '전사부터 실행 항목까지',
    title: '핵심 요약과 결정사항을 한눈에',
    description: '긴 회의도 중요한 내용과 다음 할 일을 빠르게 확인할 수 있습니다.',
  })

  await open(page, 'templates')
  await page.getByRole('button', { name: '요약 템플릿' }).click()
  await expect(page.getByRole('heading', { name: '요약 템플릿', exact: true })).toBeVisible()
  await captureProductShot(page, {
    name: '04-templates.png',
    eyebrow: '나만의 요약 템플릿',
    title: '회의마다 원하는 형식으로 정리하세요',
    description: '요약 항목과 순서를 회의 목적에 맞게 자유롭게 구성하세요.',
  })

  await open(page, 'recovery-dialog')
  await expect(page.getByRole('heading', { name: '중단된 녹음 복구' })).toBeVisible()
  await captureProductShot(page, {
    name: '05-recovery.png',
    eyebrow: '안심할 수 있는 복구',
    title: '중단되어도 녹음은 안전하게',
    description: '예기치 않은 종료 뒤에도 이어서 녹음하거나 원본을 보존할 수 있습니다.',
  })
})
