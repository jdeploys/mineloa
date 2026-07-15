import { describe, expect, it, vi } from 'vitest'
import { registerMeetingHandlers } from '../../src/main/ipc/registerMeetingHandlers'

const templates = { get: vi.fn(() => ({ sections: [] })) }

describe('meeting IPC validation', () => {
  it('validates ids and trimmed speaker names before repository access', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const repository = { listRecent: vi.fn(), create: vi.fn(), requireById: vi.fn(), listSpeakers: vi.fn(), listTranscript: vi.fn(), listSummarySections: vi.fn(), listActionItems: vi.fn(), renameSpeaker: vi.fn() }
    registerMeetingHandlers({ handle: (channel, handler) => handlers.set(channel, handler) }, repository as never, templates as never)

    await expect(handlers.get('meetings:get')?.({}, '')).rejects.toThrow()
    await expect(handlers.get('meetings:rename-speaker')?.({}, 'meeting-1', '0:B', '   ')).rejects.toThrow()
    expect(repository.requireById).not.toHaveBeenCalled()
    expect(repository.renameSpeaker).not.toHaveBeenCalled()
  })

  it('returns current repository document data and an opaque media URL without file paths', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const now = '2026-07-15T00:00:00.000Z'
    const meeting = { id: 'meeting-1', title: '회의', createdAt: now, updatedAt: now, durationMs: 1, status: 'completed', audioPolicy: 'keep', audioPath: 'private.webm', audioByteCount: 1, selectedTemplateId: null }
    const sectionId = '10000000-0000-4000-8000-000000000001'
    const repository = { listRecent: vi.fn(), create: vi.fn(), requireById: vi.fn(() => meeting), listSpeakers: vi.fn(() => []), listTranscript: vi.fn(() => []), listSummarySections: vi.fn(() => [{ id: 'section', meetingId: 'meeting-1', templateSectionId: sectionId, kind: 'paragraph', text: '요약', items: [], orderIndex: 0 }]), listActionItems: vi.fn(() => []), renameSpeaker: vi.fn() }
    const selectedTemplate = { get: vi.fn(() => ({ sections: [{ id: sectionId, title: '핵심 요약' }] })) }
    registerMeetingHandlers({ handle: (channel, handler) => handlers.set(channel, handler) }, repository as never, selectedTemplate as never)

    const result = await handlers.get('meetings:get')?.({}, 'meeting-1') as Record<string, unknown>
    expect(result).toMatchObject({ meeting: { id: 'meeting-1', hasAudio: true }, audioUrl: 'nnote-media://meeting/bWVldGluZy0x' })
    expect(result).toMatchObject({ summarySections: [{ templateSectionId: sectionId, title: '핵심 요약' }] })
    expect(selectedTemplate.get).toHaveBeenCalledWith('default')
    expect(JSON.stringify(result)).not.toContain('private.webm')
  })
})
