import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserWindow, app, ipcMain } from 'electron'
import { Entry } from '@napi-rs/keyring'
import { openDatabase } from '../db/database'
import { getWindowWebPreferences } from '../window/createMainWindow'

interface SqliteCheck { value: number; close(): void }
interface RendererCheck { title: string; desktopApiAvailable: boolean; dashboardVisible: boolean }

interface RuntimeVerificationPorts {
  checkSqlite(): SqliteCheck
  checkKeyring(): boolean
  checkRenderer(): Promise<RendererCheck>
}

export interface RuntimeVerificationSignals {
  main: true
  sqlite: true
  keyring: true
  preload: true
  renderer: true
}

function failure(component: string, cause?: unknown): Error {
  const detail = cause instanceof Error ? `: ${cause.message}` : ''
  return new Error(`Package runtime verification failed: ${component}${detail}`, { cause })
}

export async function collectRuntimeVerificationSignals(
  ports: RuntimeVerificationPorts,
): Promise<RuntimeVerificationSignals> {
  let sqlite: SqliteCheck
  try {
    sqlite = ports.checkSqlite()
    if (sqlite.value !== 1) throw new Error('unexpected query result')
  } catch (cause) {
    throw failure('sqlite', cause)
  }
  sqlite.close()

  try {
    if (!ports.checkKeyring()) throw new Error('native module unavailable')
  } catch (cause) {
    throw failure('keyring', cause)
  }

  let renderer: RendererCheck
  try {
    renderer = await ports.checkRenderer()
  } catch (cause) {
    throw failure('renderer', cause)
  }
  if (!renderer.desktopApiAvailable) throw failure('preload')
  if (renderer.title !== 'Nnote' || !renderer.dashboardVisible) throw failure('renderer')

  return { main: true, sqlite: true, keyring: true, preload: true, renderer: true }
}

async function checkRenderer(): Promise<RendererCheck> {
  const window = new BrowserWindow({
    show: false,
    webPreferences: getWindowWebPreferences(join(__dirname, '../preload/index.js')),
  })
  try {
    ipcMain.handle('recovery:scan', () => [])
    ipcMain.handle('meetings:list', () => [])
    await window.loadFile(join(__dirname, '../renderer/index.html'))
    await window.webContents.executeJavaScript(`new Promise((resolve) => {
      const done = () => resolve(Boolean([...document.querySelectorAll('h1')].find((node) => node.textContent === '새 회의')))
      if (document.readyState === 'complete') setTimeout(done, 50)
      else addEventListener('load', () => setTimeout(done, 50), { once: true })
    })`)
    return await window.webContents.executeJavaScript(`({
      title: document.title,
      desktopApiAvailable: typeof window.desktopApi === 'object' && typeof window.desktopApi.meetings?.list === 'function',
      dashboardVisible: Boolean([...document.querySelectorAll('h1')].find((node) => node.textContent === '새 회의'))
    })`) as RendererCheck
  } finally {
    ipcMain.removeHandler('recovery:scan')
    ipcMain.removeHandler('meetings:list')
    window.destroy()
  }
}

export async function runPackageRuntimeVerification(resultPath: string): Promise<void> {
  try {
    const signals = await collectRuntimeVerificationSignals({
      checkSqlite: () => {
        const database = openDatabase(join(app.getPath('userData'), 'verify.sqlite'))
        const row = database.prepare('SELECT 1 AS value').get() as { value: number }
        return {
          value: Number(row.value),
          close: () => database.close(),
        }
      },
      checkKeyring: () => {
        const entry = new Entry('Nnote Runtime Verification', 'module-load-only')
        return typeof entry.getPassword === 'function'
      },
      checkRenderer,
    })
    await writeFile(resultPath, `${JSON.stringify({ ok: true, signals })}\n`, { encoding: 'utf8', flag: 'wx' })
    app.exit(0)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Package runtime verification failed: unknown'
    await writeFile(resultPath, `${JSON.stringify({ ok: false, error: message })}\n`, { encoding: 'utf8', flag: 'wx' })
      .catch(() => undefined)
    app.exit(1)
  }
}
