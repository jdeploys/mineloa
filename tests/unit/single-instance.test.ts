import { describe, expect, it, vi } from 'vitest'
import { startSingleInstanceApp } from '../../src/main/app/singleInstance'

function appHarness(hasLock: boolean) {
  let secondInstance: (() => void) | undefined
  return {
    app: {
      requestSingleInstanceLock: vi.fn(() => hasLock),
      quit: vi.fn(),
      on: vi.fn((event: string, listener: () => void) => { if (event === 'second-instance') secondInstance = listener }),
    },
    second: () => secondInstance?.(),
  }
}

describe('single instance startup', () => {
  it('quits before starting services when the earliest lock is unavailable', () => {
    const h = appHarness(false)
    const start = vi.fn()
    expect(startSingleInstanceApp(h.app, { getAllWindows: vi.fn(() => []) }, start)).toBe(false)
    expect(h.app.quit).toHaveBeenCalledTimes(1)
    expect(start).not.toHaveBeenCalled()
  })

  it('restores and focuses the existing window for a second instance', () => {
    const h = appHarness(true)
    const window = { isDestroyed: vi.fn(() => false), isMinimized: vi.fn(() => true), restore: vi.fn(), focus: vi.fn() }
    const start = vi.fn()
    expect(startSingleInstanceApp(h.app, { getAllWindows: () => [window] }, start)).toBe(true)
    expect(start).toHaveBeenCalledTimes(1)
    h.second()
    expect(window.restore).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
  })

  it('handles a second instance safely while startup has no window', () => {
    const h = appHarness(true)
    const windows = { getAllWindows: vi.fn(() => []) }
    startSingleInstanceApp(h.app, windows, vi.fn())
    expect(() => h.second()).not.toThrow()
    expect(windows.getAllWindows).toHaveBeenCalledTimes(1)
  })
})
