import { afterEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDatabase } from '../../src/main/db/database'
import { MeetingRepository } from '../../src/main/db/meetingRepository'
import { DEFAULT_AUDIO_POLICY } from '../../src/shared/contracts/meeting'
import { CreateRecordingMeetingInputSchema } from '../../src/shared/contracts/meetingsApi'

describe('audio retention', () => {
  let database: Database.Database | null = null
  afterEach(() => database?.close())

  function repository(audioPolicy: 'keep' | 'delete_after_processing') {
    database = openDatabase(':memory:')
    const meetings = new MeetingRepository(database)
    meetings.create({
      id: 'meeting-1',
      title: '주간 회의',
      createdAt: '2026-07-30T06:42:40.148Z',
      updatedAt: '2026-07-30T06:42:40.148Z',
      durationMs: 1_162_716,
      status: 'completed',
      audioPolicy,
      audioPath: 'meeting-1.part-0.webm',
      audioByteCount: 9_000_000,
      selectedTemplateId: null,
    })
    return meetings
  }

  // A recording that is gone cannot be recovered, so a missing or unreadable
  // choice has to fall back to the side that loses nothing.
  it('defaults new recordings to keeping the audio', () => {
    expect(DEFAULT_AUDIO_POLICY).toBe('keep')
    expect(CreateRecordingMeetingInputSchema.parse({ title: '주간 회의', selectedTemplateId: 'default' }).audioPolicy)
      .toBe('keep')
  })

  // The policy used to be frozen when the meeting was created, so audio could
  // be deleted by a choice the user made before the meeting existed.
  it('lets a meeting switch to keeping audio after it was created', () => {
    const meetings = repository('delete_after_processing')

    const updated = meetings.updateAudioPolicy('meeting-1', 'keep')

    expect(updated.audioPolicy).toBe('keep')
    expect(meetings.requireById('meeting-1').audioPolicy).toBe('keep')
  })

  it('advances updated_at so the change is visible to anything watching the row', () => {
    const meetings = repository('delete_after_processing')

    const updated = meetings.updateAudioPolicy('meeting-1', 'keep')

    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(new Date('2026-07-30T06:42:40.148Z').getTime())
  })

  it('refuses when the audio is already gone rather than implying it can return', () => {
    const meetings = repository('delete_after_processing')
    database!.prepare('UPDATE meetings SET audio_path = NULL WHERE id = ?').run('meeting-1')

    expect(() => meetings.updateAudioPolicy('meeting-1', 'keep')).toThrow(/no audio/i)
  })

  it('refuses for a deleted meeting', () => {
    const meetings = repository('keep')
    database!.prepare("UPDATE meetings SET status = 'deleted' WHERE id = ?").run('meeting-1')

    expect(() => meetings.updateAudioPolicy('meeting-1', 'delete_after_processing')).toThrow(/deleted/i)
  })
})
