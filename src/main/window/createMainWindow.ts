import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'

type MainWindow = Pick<BrowserWindow, 'isMinimized' | 'restore' | 'show' | 'focus'>

export function getWindowWebPreferences(
  preload: string,
): NonNullable<BrowserWindowConstructorOptions['webPreferences']> {
  return { contextIsolation: true, nodeIntegration: false, sandbox: true, preload }
}

function isAllowedRendererUrl(candidate: string, rendererUrl: string): boolean {
  try {
    const candidateUrl = new URL(candidate)
    const trustedUrl = new URL(rendererUrl)

    if (trustedUrl.protocol === 'file:') {
      return candidateUrl.href === trustedUrl.href
    }

    return candidateUrl.origin === trustedUrl.origin
  } catch {
    return false
  }
}

export function createMainWindow(): BrowserWindow {
  const preload = join(__dirname, '../preload/index.js')
  const rendererFile = join(__dirname, '../renderer/index.html')
  const rendererUrl = process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(rendererFile).href
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 640,
    webPreferences: getWindowWebPreferences(preload),
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedRendererUrl(url, rendererUrl)) {
      event.preventDefault()
    }
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      callback(permission === 'media' && isAllowedRendererUrl(details.requestingUrl, rendererUrl))
    },
  )

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(rendererUrl)
  } else {
    void window.loadFile(rendererFile)
  }

  return window
}

export function reopenMainWindow(
  windows: readonly MainWindow[] = BrowserWindow.getAllWindows(),
  createWindow: () => MainWindow = createMainWindow,
): MainWindow {
  const window = windows[0] ?? createWindow()

  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()

  return window
}
