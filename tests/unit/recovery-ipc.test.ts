import { describe, expect, it, vi } from 'vitest'
import { registerRecoveryHandlers } from '../../src/main/ipc/registerRecoveryHandlers'

describe('recovery IPC', () => {
  it('accepts meeting ids but never renderer filesystem paths', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const service = {
      scan: vi.fn(async () => []), recover: vi.fn(), suspend: vi.fn(), keepAsFile: vi.fn(), exportOnly: vi.fn(), exportOnlyFormat: vi.fn(), discard: vi.fn(),
    }
    registerRecoveryHandlers(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      service,
    )

    await handlers.get('recovery:recover')!({}, 'meeting-1')
    expect(service.recover).toHaveBeenCalledWith('meeting-1')
    await expect(Promise.resolve().then(() => handlers.get('recovery:recover')!({}, { meetingId: 'meeting-1', path: 'C:\\secret.webm' }))).rejects.toThrow()
  })

  it('requires explicitDelete true at the IPC boundary', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const service = {
      scan: vi.fn(), recover: vi.fn(), suspend: vi.fn(), keepAsFile: vi.fn(), exportOnly: vi.fn(), exportOnlyFormat: vi.fn(), discard: vi.fn(),
    }
    registerRecoveryHandlers(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      service,
    )

    await expect(Promise.resolve().then(() => handlers.get('recovery:discard')!({}, 'meeting-1', { explicitDelete: false }))).rejects.toThrow(/explicit/i)
    expect(service.discard).not.toHaveBeenCalled()
    await handlers.get('recovery:discard')!({}, 'meeting-1', { explicitDelete: true })
    expect(service.discard).toHaveBeenCalledWith('meeting-1', { explicitDelete: true })
  })

  it('exports an inspected export-only recording through a native save dialog without renderer paths', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const exportOnly = vi.fn(async () => undefined)
    const dialog = { showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: 'C:\\trusted\\recovered.webm' })) }
    registerRecoveryHandlers(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      { scan: vi.fn(), recover: vi.fn(), suspend: vi.fn(), keepAsFile: vi.fn(), discard: vi.fn(), exportOnly, exportOnlyFormat: vi.fn(async () => ({ partCount: 1, extension: 'webm' as const })) },
      dialog,
    )

    expect(await handlers.get('recovery:export-only')!({}, 'meeting-1')).toEqual({ status: 'success' })
    expect(dialog.showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({ filters: [{ name: 'WebM audio', extensions: ['webm'] }] }))
    expect(exportOnly).toHaveBeenCalledWith('meeting-1', 'C:\\trusted\\recovered.webm')
    await expect(Promise.resolve().then(() => handlers.get('recovery:export-only')!({}, { meetingId: 'meeting-1', path: 'C:\\evil' }))).rejects.toThrow()
  })

  it('selects a ZIP destination for multi-part recovery without exposing a path to the renderer', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const exportOnly = vi.fn(async () => undefined)
    const dialog = { showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: 'C:\\trusted\\recovered.zip' })) }
    registerRecoveryHandlers(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      { scan: vi.fn(), recover: vi.fn(), suspend: vi.fn(), keepAsFile: vi.fn(), discard: vi.fn(), exportOnly, exportOnlyFormat: vi.fn(async () => ({ partCount: 2, extension: 'zip' as const })) },
      dialog,
    )

    expect(await handlers.get('recovery:export-only')!({}, 'meeting-1')).toEqual({ status: 'success' })
    expect(dialog.showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({
      defaultPath: 'recovered-recording.zip', filters: [{ name: 'Nnote recovery package', extensions: ['zip'] }],
    }))
    expect(exportOnly).toHaveBeenCalledWith('meeting-1', 'C:\\trusted\\recovered.zip')
  })
})
