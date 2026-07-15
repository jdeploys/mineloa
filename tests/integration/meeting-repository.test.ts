import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Meeting, TranscriptSegment } from '../../src/shared/contracts/meeting'
import type { SummaryTemplate } from '../../src/shared/contracts/template'
import { openDatabase } from '../../src/main/db/database'
import { MeetingRepository } from '../../src/main/db/meetingRepository'
import { TemplateRepository } from '../../src/main/db/templateRepository'

const directories: string[] = []

function temporaryDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'nnote-database-'))
  directories.push(directory)
  return join(directory, 'nnote.sqlite')
}

function recordingMeeting(): Meeting {
  return {
    id: 'meeting-1',
    title: 'Weekly planning',
    createdAt: '2026-07-14T12:00:00.000Z',
    updatedAt: '2026-07-14T12:00:00.000Z',
    durationMs: 9_000,
    status: 'recording',
    audioPolicy: 'delete_after_processing',
    audioPath: 'recordings/meeting-1/part-0.webm',
    audioByteCount: 12_345,
    selectedTemplateId: null,
  }
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('MeetingRepository', () => {
  it('lists recent non-deleted meetings newest first without changing recording state', () => {
    const directory = mkdtempSync(join(tmpdir(), 'nnote-recent-'))
    const database = openDatabase(join(directory, 'meetings.sqlite'))
    const repository = new MeetingRepository(database)
    const base = recordingMeeting()
    repository.create({ ...base, id: 'older', createdAt: '2026-07-14T00:00:00.000Z', updatedAt: '2026-07-14T00:00:00.000Z' })
    repository.create({ ...base, id: 'newer', createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z', status: 'recoverable' })
    repository.create({ ...base, id: 'deleted', createdAt: '2026-07-16T00:00:00.000Z', updatedAt: '2026-07-16T00:00:00.000Z', status: 'deleted' })

    expect(repository.listRecent().map(({ id }) => id)).toEqual(['newer', 'older'])
    expect(repository.requireById('newer').status).toBe('recoverable')
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('persists recording status, byte count, and audio policy across reopen', () => {
    const databasePath = temporaryDatabasePath()
    const firstDatabase = openDatabase(databasePath)
    const firstRepository = new MeetingRepository(firstDatabase)

    firstRepository.create(recordingMeeting())
    expect(firstDatabase.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(firstDatabase.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(firstDatabase.pragma('busy_timeout', { simple: true })).toBe(5_000)
    firstDatabase.close()

    const reopenedDatabase = openDatabase(databasePath)
    const persisted = new MeetingRepository(reopenedDatabase).findById('meeting-1')
    reopenedDatabase.close()

    expect(persisted).toMatchObject({
      status: 'recording',
      audioByteCount: 12_345,
      audioPolicy: 'delete_after_processing',
    })
  })

  it('rolls back an invalid transcript segment insert without changing the meeting', () => {
    const databasePath = temporaryDatabasePath()
    const database = openDatabase(databasePath)
    const repository = new MeetingRepository(database)
    const meeting = repository.create(recordingMeeting())
    const segments: TranscriptSegment[] = [
      {
        id: 'segment-1',
        meetingId: meeting.id,
        speakerId: null,
        startMs: 0,
        endMs: 1_000,
        text: 'Opening remarks',
      },
      {
        id: 'segment-2',
        meetingId: meeting.id,
        speakerId: null,
        startMs: 2_000,
        endMs: 1_000,
        text: 'Invalid timing',
      },
    ]

    expect(() => repository.replaceTranscript(meeting.id, segments)).toThrow()
    expect(repository.findById(meeting.id)).toEqual(meeting)
    expect(repository.listTranscript(meeting.id)).toEqual([])

    database.close()
    expect(() => readFileSync(databasePath)).not.toThrow()
  })

  it('rejects a speaker from another meeting without inserting transcript segments', () => {
    const database = openDatabase(temporaryDatabasePath())
    const repository = new MeetingRepository(database)
    const firstMeeting = repository.create(recordingMeeting())
    const secondMeeting = repository.create({ ...recordingMeeting(), id: 'meeting-2' })
    database
      .prepare('INSERT INTO speakers (id, meeting_id, display_name) VALUES (?, ?, ?)')
      .run('speaker-2', secondMeeting.id, 'Other meeting speaker')

    expect(() =>
      repository.replaceTranscript(firstMeeting.id, [
        {
          id: 'segment-cross-meeting',
          meetingId: firstMeeting.id,
          speakerId: 'speaker-2',
          startMs: 0,
          endMs: 1_000,
          text: 'Wrong speaker ownership',
        },
      ]),
    ).toThrow()
    expect(repository.listTranscript(firstMeeting.id)).toEqual([])

    database.close()
  })
})

describe('TemplateRepository', () => {
  it('round-trips an ordered summary template', () => {
    const database = openDatabase(temporaryDatabasePath())
    const repository = new TemplateRepository(database)
    const template: SummaryTemplate = {
      id: 'template-1',
      name: 'Decision review',
      isDefault: false,
      sections: [
        { id: '10000000-0000-4000-8000-000000000011', title: 'Decisions', kind: 'bullet_list', prompt: 'List decisions.' },
        { id: '10000000-0000-4000-8000-000000000012', title: 'Actions', kind: 'action_items', prompt: 'List actions.' },
      ],
      createdAt: '2026-07-14T12:00:00.000Z',
      updatedAt: '2026-07-14T12:00:00.000Z',
    }

    expect(repository.save(template)).toEqual(template)
    expect(repository.list()).toEqual([template])

    database.close()
  })
})
