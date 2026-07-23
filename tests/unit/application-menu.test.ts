import { describe, expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import { buildApplicationMenuTemplate } from '../../src/main/window/applicationMenu'
import { reopenMainWindow } from '../../src/main/window/createMainWindow'

function submenuOf(
  template: MenuItemConstructorOptions[],
  label: string,
): MenuItemConstructorOptions[] {
  const menu = template.find((item) => item.label === label)
  expect(menu).toBeDefined()
  expect(Array.isArray(menu?.submenu)).toBe(true)
  return menu?.submenu as MenuItemConstructorOptions[]
}

describe('application window menu', () => {
  it('lists the main window and wires it to the reopen action', () => {
    const reopen = vi.fn()
    const template = buildApplicationMenuTemplate('Mineloa', true, reopen)
    const windowItems = submenuOf(template, 'Window')
    const mainWindow = windowItems.find((item) => item.label === 'Mineloa')

    expect(mainWindow).toMatchObject({ accelerator: 'CmdOrCtrl+0' })
    expect(mainWindow?.click).toBe(reopen)
  })

  it('restores, shows, and focuses an existing main window', () => {
    const window = {
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
    }
    const createWindow = vi.fn()

    expect(reopenMainWindow([window], createWindow)).toBe(window)
    expect(createWindow).not.toHaveBeenCalled()
    expect(window.restore).toHaveBeenCalledOnce()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
  })

  it('creates a new main window after the previous one was closed', () => {
    const window = {
      isMinimized: vi.fn(() => false),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
    }
    const createWindow = vi.fn(() => window)

    expect(reopenMainWindow([], createWindow)).toBe(window)
    expect(createWindow).toHaveBeenCalledOnce()
    expect(window.restore).not.toHaveBeenCalled()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
  })
})
