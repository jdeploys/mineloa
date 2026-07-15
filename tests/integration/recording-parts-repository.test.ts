import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db/database'
import { MeetingRepository } from '../../src/main/db/meetingRepository'

const roots: string[] = []

describe('MeetingRepository recording part ownership', () => {
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

  it('atomically replaces and lists every owned part in index order', () => {
    const root = mkdtempSync(join(tmpdir(), 'nnote-parts-')); roots.push(root)
    const database = openDatabase(join(root, 'db.sqlite'))
    const repository = new MeetingRepository(database)
    repository.create({ id: 'meeting', title: 'm', createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z', durationMs: 2, status: 'recorded', audioPolicy: 'keep', audioPath: 'meeting.part-0.webm', audioByteCount: 5, selectedTemplateId: null })

    repository.replaceRecordingParts('meeting', [
      { partIndex: 0, relativePath: 'meeting.part-0.webm', byteCount: 2, durationMs: 1 },
      { partIndex: 1, relativePath: 'meeting.part-1.webm', byteCount: 3, durationMs: 2 },
    ])

    expect(repository.listRecordingParts('meeting')).toEqual([
      { meetingId: 'meeting', partIndex: 0, relativePath: 'meeting.part-0.webm', byteCount: 2, durationMs: 1 },
      { meetingId: 'meeting', partIndex: 1, relativePath: 'meeting.part-1.webm', byteCount: 3, durationMs: 2 },
    ])
    repository.deleteRecordingParts('meeting')
    expect(repository.listRecordingParts('meeting')).toEqual([])
    database.close()
  })

  it('rejects a gapped replacement without deleting the prior ownership rows', () => {
    const root = mkdtempSync(join(tmpdir(), 'nnote-parts-')); roots.push(root)
    const database = openDatabase(join(root, 'db.sqlite'))
    const repository = new MeetingRepository(database)
    repository.create({ id: 'meeting', title: 'm', createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z', durationMs: 2, status: 'recorded', audioPolicy: 'keep', audioPath: null, audioByteCount: 0, selectedTemplateId: null })
    repository.replaceRecordingParts('meeting', [{ partIndex: 0, relativePath: 'safe.webm', byteCount: 1, durationMs: 1 }])

    expect(() => repository.replaceRecordingParts('meeting', [{ partIndex: 1, relativePath: 'other.webm', byteCount: 1, durationMs: 1 }])).toThrow(/contiguous/i)
    expect(repository.listRecordingParts('meeting').map((part) => part.relativePath)).toEqual(['safe.webm'])
    database.close()
  })
})
