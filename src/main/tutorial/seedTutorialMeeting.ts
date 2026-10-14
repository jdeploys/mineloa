import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, rm, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import transcript from '../../../resources/tutorial/transcript.json'
import { TUTORIAL_ATTRIBUTION, TUTORIAL_MEETING_ID } from '../../shared/tutorialMeeting'
import { completedPartPath } from '../recording/recordingPaths'
import { MeetingRepository } from '../db/meetingRepository'
import { DEFAULT_TEMPLATE_SECTIONS } from '../templates/defaultTemplate'

const marker = 'tutorial_meeting_v1'

export async function seedTutorialMeeting(database: Database.Database, recordingsDirectory: string, audioSource: string, firstInstall: boolean): Promise<void> {
  const state = database.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(marker) as { value_json: string } | undefined
  if (!state) {
    // Persist eligibility before file work so interrupted first launches can retry.
    const eligible = firstInstall && (database.prepare('SELECT count(*) AS count FROM meetings').get() as { count: number }).count === 0
    database.prepare('INSERT INTO app_settings (key, value_json) VALUES (?, ?)').run(marker, JSON.stringify(eligible ? 'pending' : 'skipped'))
    if (!eligible) return
  } else if (state.value_json !== JSON.stringify('pending')) return

  const audioPath = completedPartPath(recordingsDirectory, TUTORIAL_MEETING_ID, 0)
  await mkdir(recordingsDirectory, { recursive: true })
  await copyFile(audioSource, audioPath)
  try {
    const byteCount = (await stat(audioPath)).size
    database.transaction(() => {
      const now = new Date().toISOString()
      const templateId = 'mineloa-tutorial-template'
      const sections = DEFAULT_TEMPLATE_SECTIONS.map((section) => ({ ...section, id: randomUUID() }))
      sections.push({ id: randomUUID(), title: '예제 안내 및 출처', kind: 'paragraph', prompt: 'Preserve the sample attribution and explain that this is a tutorial excerpt.' })
      database.prepare('INSERT INTO summary_templates (id, name, sections_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(templateId, '튜토리얼 회의', JSON.stringify(sections), now, now)
      database.prepare(`INSERT INTO meetings (id, title, created_at, updated_at, duration_ms, status, audio_policy, audio_path, audio_byte_count, selected_template_id)
        VALUES (?, ?, ?, ?, 225000, 'completed', 'keep', ?, ?, ?)`)
        .run(TUTORIAL_MEETING_ID, '[샘플] Remote control design meeting', now, now, basename(audioPath), byteCount, templateId)
      database.prepare('INSERT INTO recording_parts (meeting_id, part_index, relative_path, byte_count, duration_ms) VALUES (?, 0, ?, ?, 225000)')
        .run(TUTORIAL_MEETING_ID, basename(audioPath), byteCount)
      const speakers = new Map(['A', 'B', 'C', 'D'].map((label) => [label, randomUUID()]))
      for (const [label, id] of speakers) database.prepare('INSERT INTO speakers (id, meeting_id, display_name) VALUES (?, ?, ?)').run(id, TUTORIAL_MEETING_ID, `Participant ${label}`)
      for (const segment of transcript) database.prepare('INSERT INTO transcript_segments (id, meeting_id, speaker_id, start_ms, end_ms, text) VALUES (?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), TUTORIAL_MEETING_ID, speakers.get(segment.speaker), segment.startMs, segment.endMs, segment.text)
      const contents = [
        { text: 'The team explores a simpler remote control: clear symbols, basic physical buttons, and an optional LCD menu. They discuss accessibility for older users, screen cost, and a flip-top design. No final hardware design is selected in this excerpt.', items: [] },
        { text: '', items: [{ text: 'Work individually and reconvene in about half an hour.', atMs: 217890 }] },
        { text: '', items: [] },
        { text: '', items: [
          { text: 'Keep basic controls obvious; hide advanced functions or place them in a menu.', atMs: 2430 },
          { text: 'Consider an LCD menu, while accounting for older users and confusing navigation.', atMs: 24840 },
          { text: 'Explore large print and a flip-top screen, subject to cost constraints.', atMs: 143690 },
        ] },
        { text: `튜토리얼용 영어 회의입니다. 음원을 재생하고 화자별 전사·요약·할 일을 살펴보세요. 전사는 AMI의 수동 전사이며 요약은 미리 작성한 예제입니다. 이 기록은 자유롭게 삭제할 수 있습니다.\n\n${TUTORIAL_ATTRIBUTION}`, items: [] },
      ]
      const insert = database.prepare('INSERT INTO summary_sections (id, meeting_id, template_section_id, kind, content_json, order_index) VALUES (?, ?, ?, ?, ?, ?)')
      sections.forEach((section, index) => insert.run(randomUUID(), TUTORIAL_MEETING_ID, section.id, section.kind, JSON.stringify(contents[index]), index))
      database.prepare('INSERT INTO action_items (id, meeting_id, content, assignee_speaker_id, due_at, at_ms, completed) VALUES (?, ?, ?, NULL, NULL, ?, 0)')
        .run(randomUUID(), TUTORIAL_MEETING_ID, 'Each team member: continue individual design work before the next meeting (about 30 minutes later).', 217890)
      database.prepare('UPDATE app_settings SET value_json = ? WHERE key = ?').run(JSON.stringify('completed'), marker)
    })()
    // Validate the persisted content through the same readers used by the UI.
    const meetings = new MeetingRepository(database)
    meetings.requireById(TUTORIAL_MEETING_ID)
    meetings.listSummarySections(TUTORIAL_MEETING_ID)
  } catch (error) {
    if (!database.prepare('SELECT id FROM meetings WHERE id = ?').get(TUTORIAL_MEETING_ID)) await rm(audioPath, { force: true })
    throw error
  }
}
