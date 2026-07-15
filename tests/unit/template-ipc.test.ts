import { describe, expect, it, vi } from 'vitest'
import { registerTemplateHandlers } from '../../src/main/ipc/registerTemplateHandlers'

function harness() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const service = {
    list: vi.fn(() => []), create: vi.fn((value) => value), update: vi.fn(),
    reorderSections: vi.fn(), delete: vi.fn(),
  }
  registerTemplateHandlers({ handle: (channel, listener) => handlers.set(channel, listener) }, service as never)
  return { handlers, service }
}

describe('template IPC', () => {
  it('strictly validates template payloads before invoking the service', async () => {
    const { handlers, service } = harness()
    const valid = { name: '회의', sections: [{ title: '요약', kind: 'paragraph', prompt: '요약하세요' }] }
    await handlers.get('templates:create')!({}, valid)
    expect(service.create).toHaveBeenCalledWith(valid)

    await expect(Promise.resolve().then(() => handlers.get('templates:create')!({}, { ...valid, path: 'C:\\secret' }))).rejects.toThrow()
    await expect(Promise.resolve().then(() => handlers.get('templates:create')!({}, { ...valid, sections: [{ ...valid.sections[0], kind: 'markdown' }] }))).rejects.toThrow()
    expect(service.create).toHaveBeenCalledTimes(1)
  })

  it('routes default mutations through the immutable service boundary and rejects malformed reorder ids', async () => {
    const { handlers, service } = harness()
    await expect(Promise.resolve().then(() => handlers.get('templates:update')!({}, 'default', { name: '바꿈' }))).rejects.toThrow(/immutable/)
    expect(service.update).not.toHaveBeenCalled()
    await expect(Promise.resolve().then(() => handlers.get('templates:delete')!({}, 'default'))).rejects.toThrow(/immutable/)
    expect(service.delete).not.toHaveBeenCalled()
    await expect(Promise.resolve().then(() => handlers.get('templates:reorder-sections')!({}, 'custom', ['not-a-uuid']))).rejects.toThrow()
    expect(service.reorderSections).not.toHaveBeenCalled()
  })
})
