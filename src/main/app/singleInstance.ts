interface SingleInstanceApp {
  requestSingleInstanceLock(): boolean
  quit(): void
  on(event: 'second-instance', listener: () => void): void
}

interface FocusableWindow {
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  focus(): void
}

interface WindowSource { getAllWindows(): FocusableWindow[] }

export function startSingleInstanceApp(
  app: SingleInstanceApp,
  windows: WindowSource,
  start: () => void,
): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return false
  }
  app.on('second-instance', () => {
    const window = windows.getAllWindows().find((candidate) => !candidate.isDestroyed())
    if (window === undefined) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })
  start()
  return true
}
