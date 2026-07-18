import { defineConfig } from '@playwright/test'

const port = process.env.NNOTE_APP_STORE_SCREENSHOT_PORT ?? '5183'

export default defineConfig({
  testDir: 'tests/app-store',
  testMatch: '**/*.pw.ts',
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  },
  webServer: {
    command: `npx vite tests/visual/harness --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
})
