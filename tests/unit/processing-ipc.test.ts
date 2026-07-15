import { describe, expect, it, vi } from 'vitest'
import { registerProcessingHandlers } from '../../src/main/ipc/registerProcessingHandlers'

function sender() {
  let destroyed = false
  let onDestroyed: (() => void) | undefined
  return {
    sends: [] as unknown[][],
    isDestroyed: () => destroyed,
    send(channel: string, value: unknown) { this.sends.push([channel, value]) },
    once: vi.fn((_event: string, listener: () => void) => { onDestroyed = listener }),
    destroy() { destroyed = true; onDestroyed?.() },
  }
}

function harness() {
  const handlers = new Map<string, (...args: any[]) => unknown>()
  const progress = { meetingId: 'meeting-1', state: 'transcribing', failedStage: null, retryable: false, audioRequired: true, error: null }
  let observer!: (value: typeof progress) => void
  const service = {
    process: vi.fn(), retry: vi.fn(),
    getStatus: vi.fn((meetingId: string) => ({ ...progress, meetingId, state: 'recorded' })),
    subscribe: vi.fn((listener) => { observer = listener; return () => undefined }),
  }
  registerProcessingHandlers({ handle: (channel, listener) => handlers.set(channel, listener) }, service as never)
  return { handlers, service, emit: (value = progress) => observer(value) }
}

describe('processing IPC', () => {
  it('validates meeting ids and exposes only typed processing actions', async () => {
    const { handlers, service } = harness()
    const source = sender()
    await handlers.get('processing:process')!({ sender: source }, 'meeting-1')
    expect(service.process).toHaveBeenCalledWith('meeting-1')
    await expect(Promise.resolve().then(() => handlers.get('processing:retry')!({ sender: source }, '../secret'))).rejects.toThrow()
    expect(service.retry).not.toHaveBeenCalled()
  })

  it('sends progress only to senders scoped to that meeting and removes destroyed senders', () => {
    const { handlers, emit } = harness()
    const first = sender()
    const second = sender()
    handlers.get('processing:get-status')!({ sender: first }, 'meeting-1')
    handlers.get('processing:get-status')!({ sender: second }, 'meeting-2')
    emit()
    expect(first.sends).toHaveLength(1)
    expect(second.sends).toHaveLength(0)
    first.destroy()
    emit()
    expect(first.sends).toHaveLength(1)
  })

  it('isolates a sender destroyed between its check and send', () => {
    const { handlers, emit } = harness()
    const source = sender()
    source.send = vi.fn(() => { throw new Error('destroy race') })
    handlers.get('processing:get-status')!({ sender: source }, 'meeting-1')
    expect(() => emit()).not.toThrow()
  })
})
