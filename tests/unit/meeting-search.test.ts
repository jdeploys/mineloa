import { afterEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDatabase } from '../../src/main/db/database'
import { MeetingRepository } from '../../src/main/db/meetingRepository'

describe('recent meeting search', () => {
  let database: Database.Database | null = null
  afterEach(() => database?.close())

  it('finds title, transcript, summary, and action item content and applies an inclusive UI date range', () => {
    database = openDatabase(':memory:')
    const repository = new MeetingRepository(database)
    const create = (id: string, title: string, createdAt: string, status: 'completed' | 'deleted' = 'completed') => repository.create({
      id, title, createdAt, updatedAt: createdAt, durationMs: 1_000, status,
      audioPolicy: 'keep', audioPath: null, audioByteCount: 0, selectedTemplateId: null,
    })
    create('title', '분기 로드맵', '2026-07-01T03:00:00.000Z')
    create('transcript', '고객 회의', '2026-07-10T03:00:00.000Z')
    create('summary', '주간 회의', '2026-07-18T14:59:59.000Z')
    create('action', '운영 회의', '2026-07-19T00:00:00.000Z')
    create('deleted', '비공개 로드맵', '2026-07-05T03:00:00.000Z', 'deleted')

    database.prepare('INSERT INTO transcript_segments (id, meeting_id, speaker_id, start_ms, end_ms, text) VALUES (?, ?, NULL, 0, 1000, ?)').run('t1', 'transcript', '신규 예산을 검토했습니다')
    database.prepare('INSERT INTO summary_sections (id, meeting_id, template_section_id, kind, content_json, order_index) VALUES (?, ?, NULL, ?, ?, 0)').run('s1', 'summary', 'paragraph', JSON.stringify({ text: '채용 계획 확정', items: [] }))
    database.prepare('INSERT INTO action_items (id, meeting_id, content, completed) VALUES (?, ?, ?, 0)').run('a1', 'action', '견적서 발송')

    const search = (query: string) => repository.searchRecent({ query, from: null, toExclusive: null }).map(({ id }) => id)
    expect(search('로드맵')).toEqual(['title'])
    expect(search('예산')).toEqual(['transcript'])
    expect(search('채용')).toEqual(['summary'])
    expect(search('견적서')).toEqual(['action'])
    expect(repository.searchRecent({ query: '', from: '2026-07-01T00:00:00.000Z', toExclusive: '2026-07-19T00:00:00.000Z' }).map(({ id }) => id))
      .toEqual(['summary', 'transcript', 'deleted', 'title'].filter((id) => id !== 'deleted'))
  })
})
