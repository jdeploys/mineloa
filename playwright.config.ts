import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests',
  testMatch: ['visual/**/*.pw.ts', 'e2e/**/*.spec.ts'],
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4178', viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 },
  webServer: {
    command: 'npx vite tests/visual/harness --host 127.0.0.1 --port 4178 --strictPort',
    url: 'http://127.0.0.1:4178',
    reuseExistingServer: false,
  },
  snapshotPathTemplate: '{testDir}/visual/snapshots/{platform}/{arg}{ext}',
})
