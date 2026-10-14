import { mkdtempSync, rmSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db/database'
import { MeetingRepository } from '../../src/main/db/meetingRepository'
import { seedTutorialMeeting } from '../../src/main/tutorial/seedTutorialMeeting'
import { TUTORIAL_MEETING_ID } from '../../src/shared/tutorialMeeting'
import { createMediaResponse, meetingMediaUrl } from '../../src/main/media/registerMediaProtocol'

const source = resolve('resources/tutorial/meeting.webm')

describe('first-install tutorial', () => {
  it('seeds playable audio and matching manual content once, and never resurrects a deleted sample', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mineloa-tutorial-'))
    const database = openDatabase(join(root, 'db.sqlite'))
    try {
      await seedTutorialMeeting(database, root, source, true)
      const meetings = new MeetingRepository(database)
      const meeting = meetings.requireById(TUTORIAL_MEETING_ID)
      expect(meeting.status).toBe('completed')
      expect(meeting.durationMs).toBe(225000)
      expect((await stat(join(root, meeting.audioPath!))).size).toBe(meeting.audioByteCount)
      const segments = meetings.listTranscript(meeting.id)
      expect(segments).toHaveLength(82)
      expect(segments.every(s => s.startMs >= 0 && s.endMs <= meeting.durationMs)).toBe(true)
      expect(meetings.listSpeakers(meeting.id)).toHaveLength(4)
      expect(meetings.listSummarySections(meeting.id).at(-1)?.text).toContain('CC BY 4.0')
      expect(meetings.listActionItems(meeting.id)[0]?.assigneeSpeakerId).toBeNull()
      const response = await createMediaResponse(new Request(meetingMediaUrl(meeting.id), { method: 'HEAD' }), meetings, root)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('audio/webm')
      database.prepare('DELETE FROM meetings WHERE id = ?').run(meeting.id)
      await seedTutorialMeeting(database, root, source, false)
      expect(meetings.listRecent()).toEqual([])
    } finally { database.close(); rmSync(root, { recursive: true, force: true }) }
  })

  it('leaves existing installations empty and retries interrupted first-install initialization', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mineloa-tutorial-'))
    const database = openDatabase(join(root, 'db.sqlite'))
    try {
      await seedTutorialMeeting(database, root, source, false)
      expect(new MeetingRepository(database).listRecent()).toEqual([])
      database.prepare("DELETE FROM app_settings WHERE key = 'tutorial_meeting_v1'").run()
      await expect(seedTutorialMeeting(database, root, join(root, 'missing.webm'), true)).rejects.toThrow()
      await seedTutorialMeeting(database, root, source, false)
      expect(new MeetingRepository(database).listRecent()).toHaveLength(1)
    } finally { database.close(); rmSync(root, { recursive: true, force: true }) }
  })
})
