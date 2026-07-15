import { describe, expect, it, vi } from 'vitest'
import { readBoundedArchiveFile, registerArchiveHandlers } from '../../src/main/ipc/registerArchiveHandlers'

function setup(dialog: any, repository: any) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  registerArchiveHandlers({ handle: (channel, listener) => handlers.set(channel, listener) }, dialog, repository, { findById: () => null }, {} as any, 'C:\\trusted\\recordings')
  return handlers
}

describe('archive IPC', () => {
  it.each(['recording', 'recoverable', 'transcribing', 'summarizing', 'failed'])(
    'rejects transient %s export before opening a save dialog or writing', async (status) => {
      const showSaveDialog = vi.fn()
      const handlers = setup({ showSaveDialog, showOpenDialog: vi.fn() }, {
        requireById: () => ({ id: 'meeting-1', title: '회의', status }),
      })

      expect(await handlers.get('archive:export-meeting')!({}, 'meeting-1')).toMatchObject({ status: 'failure', code: 'EXPORT_FAILED' })
      expect(await handlers.get('archive:export-markdown')!({}, 'meeting-1')).toMatchObject({ status: 'failure', code: 'EXPORT_FAILED' })
      expect(showSaveDialog).not.toHaveBeenCalled()
    },
  )

  it('reads from one open handle and rejects growth or truncation without a path stat/read race', async () => {
    let statCalls = 0
    let readCalls = 0
    const close = vi.fn(async () => undefined)
    const adapter = { open: vi.fn(async () => ({
      stat: async () => ({ size: ++statCalls === 1 ? 4 : 5, isFile: () => true }),
      read: async (buffer: Uint8Array) => { if (readCalls++ > 0) return { bytesRead: 0 }; buffer.set([1, 2, 3, 4]); return { bytesRead: 4 } }, close,
    })) }
    await expect(readBoundedArchiveFile('renderer-cannot-select-this', adapter as any, 10)).rejects.toThrow(/changed/i)
    expect(adapter.open).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('rejects an oversized handle from fstat before allocating its declared size', async () => {
    const read = vi.fn()
    const adapter = { open: async () => ({ stat: async () => ({ size: 11, isFile: () => true }), read, close: async () => undefined }) }
    await expect(readBoundedArchiveFile('x', adapter as any, 10)).rejects.toThrow(/100MB|large/i)
    expect(read).not.toHaveBeenCalled()
  })

  it('returns a typed cancellation without exposing a selected path', async () => {
    const meeting = { id: 'meeting-1', title: '회의', status: 'completed', audioPath: null, selectedTemplateId: null }
    const handlers = setup({ showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }, { requireById: () => meeting })
    expect(await handlers.get('archive:export-meeting')!({}, 'meeting-1')).toEqual({ status: 'cancelled' })
    expect(await handlers.get('archive:import-meeting')!({})).toEqual({ status: 'cancelled' })
  })

  it('does not expose a private audio path through typed export failure', async () => {
    const secret = 'C:\\Users\\private\\audio.webm'
    const meeting = { id: 'meeting-1', title: '회의', createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z', durationMs: 1, status: 'completed', audioPolicy: 'keep', audioPath: secret, audioByteCount: 1, selectedTemplateId: null }
    const handlers = setup({ showSaveDialog: async () => ({ canceled: false, filePath: 'C:\\exports\\safe.nnote' }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }, {
      requireById: () => meeting, listSpeakers: () => [], listTranscript: () => [], listSummarySections: () => [], listActionItems: () => [],
    })
    const result = await handlers.get('archive:export-meeting')!({}, 'meeting-1')
    expect(result).toMatchObject({ status: 'failure', code: 'EXPORT_FAILED' })
    expect(JSON.stringify(result)).not.toContain(secret)
  })
})
