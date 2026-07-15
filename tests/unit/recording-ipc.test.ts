import { describe, expect, it, vi } from 'vitest'
import { registerRecordingHandlers } from '../../src/main/ipc/registerRecordingHandlers'

describe('recording IPC', () => {
  it('routes failed-start cancellation through RecordingService', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const service = { start: vi.fn(), cancelStart: vi.fn(), appendChunk: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn(), discard: vi.fn() }
    registerRecordingHandlers({ handle: (channel, handler) => handlers.set(channel, handler) }, service)

    await handlers.get('recording:cancel-start')?.({}, 'meeting-1')

    expect(service.cancelStart).toHaveBeenCalledWith('meeting-1')
  })

  it('validates and forwards an Opus chunk to RecordingService', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipcMain = {
      handle: (channel: string, listener: (...args: unknown[]) => unknown) => handlers.set(channel, listener),
    }
    const service = {
      start: vi.fn(),
      appendChunk: vi.fn(async () => ({ totalBytes: 2, durationMs: 1_000, warn: false, rolledToPartIndex: null, activePartIndex: 0, nextChunkIndex: 1 })),
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
      discard: vi.fn(),
      cancelStart: vi.fn(),
    }
    registerRecordingHandlers(ipcMain, service)

    await handlers.get('recording:append-chunk')!({}, {
      meetingId: 'meeting-1', partIndex: 0, chunkIndex: 0, durationMs: 1_000,
      mimeType: 'audio/webm;codecs=opus', bytes: Uint8Array.from([1, 2]),
    })

    expect(service.appendChunk).toHaveBeenCalledWith({
      meetingId: 'meeting-1', partIndex: 0, chunkIndex: 0, durationMs: 1_000,
      bytes: Uint8Array.from([1, 2]),
    })
  })

  it('rejects non-Opus chunks before they reach RecordingService', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const service = {
      start: vi.fn(), cancelStart: vi.fn(), appendChunk: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn(), discard: vi.fn(),
    }
    registerRecordingHandlers(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      service,
    )

    await expect(handlers.get('recording:append-chunk')!({}, {
      meetingId: 'meeting-1', partIndex: 0, chunkIndex: 0, durationMs: 1_000,
      mimeType: 'audio/mp4', bytes: Uint8Array.from([1]),
    })).rejects.toThrow(/webm/i)
    expect(service.appendChunk).not.toHaveBeenCalled()
  })
})
