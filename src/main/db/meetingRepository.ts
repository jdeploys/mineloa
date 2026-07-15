import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import {
  MeetingSchema,
  SpeakerSchema,
  TranscriptSegmentSchema,
  type Meeting,
  type Speaker,
  type TranscriptSegment,
} from '../../shared/contracts/meeting'
import {
  StoredActionItemSchema,
  StoredSummarySectionSchema,
  type StoredActionItem,
  type StoredSummarySection,
} from '../../shared/contracts/summary'
import { assertMeetingTransition } from '../domain/meetingState'

interface MeetingRow {
  id: string
  title: string
  created_at: string
  updated_at: string
  duration_ms: number
  status: string
  audio_policy: string
  audio_path: string | null
  audio_byte_count: number
  selected_template_id: string | null
}

interface TranscriptSegmentRow {
  id: string
  meeting_id: string
  speaker_id: string | null
  start_ms: number
  end_ms: number
  text: string
}

interface SpeakerRow {
  id: string
  meeting_id: string
  display_name: string
}

interface SummarySectionRow {
  id: string
  meeting_id: string
  template_section_id: string
  kind: string
  content_json: string
  order_index: number
}

interface ActionItemRow {
  id: string
  meeting_id: string
  content: string
  assignee_speaker_id: string | null
  due_at: string | null
  completed: number
}

interface RecordingPartRow {
  meeting_id: string
  part_index: number
  relative_path: string
  byte_count: number
  duration_ms: number
}

export interface RecordingPart {
  meetingId: string
  partIndex: number
  relativePath: string
  byteCount: number
  durationMs: number
}

export type RecordingPartInput = Omit<RecordingPart, 'meetingId'>

export type ProcessingStage = 'transcribing' | 'summarizing' | 'cleanup'

export interface ProcessingAttempt {
  id: string
  meetingId: string
  stage: ProcessingStage
  startedAt: string
  finishedAt: string | null
  succeeded: boolean | null
  error: { code: string; message: string; retryable: boolean } | null
  ownerId: string | null
}

interface ProcessingAttemptRow {
  id: string
  meeting_id: string
  stage: string
  started_at: string
  finished_at: string | null
  succeeded: number | null
  sanitized_error: string | null
  owner_id: string | null
}

export class ProcessingAttemptConflictError extends Error {
  readonly code = 'PROCESSING_ALREADY_RUNNING'
  constructor() { super('Processing is already running for this meeting') }
}

function toMeeting(row: MeetingRow): Meeting {
  return MeetingSchema.parse({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    durationMs: row.duration_ms,
    status: row.status,
    audioPolicy: row.audio_policy,
    audioPath: row.audio_path,
    audioByteCount: row.audio_byte_count,
    selectedTemplateId: row.selected_template_id,
  })
}

function toTranscriptSegment(row: TranscriptSegmentRow): TranscriptSegment {
  return TranscriptSegmentSchema.parse({
    id: row.id,
    meetingId: row.meeting_id,
    speakerId: row.speaker_id,
    startMs: row.start_ms,
    endMs: row.end_ms,
    text: row.text,
  })
}

function inTransaction<T>(database: Database.Database, write: () => T): T {
  database.exec('BEGIN IMMEDIATE')
  try {
    const result = write()
    database.exec('COMMIT')
    return result
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export class MeetingRepository {
  constructor(private readonly database: Database.Database) {}

  create(value: Meeting): Meeting {
    const meeting = MeetingSchema.parse(value)
    return inTransaction(this.database, () => {
      this.database
        .prepare(
          `INSERT INTO meetings (
            id, title, created_at, updated_at, duration_ms, status,
            audio_policy, audio_path, audio_byte_count, selected_template_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          meeting.id,
          meeting.title,
          meeting.createdAt,
          meeting.updatedAt,
          meeting.durationMs,
          meeting.status,
          meeting.audioPolicy,
          meeting.audioPath,
          meeting.audioByteCount,
          meeting.selectedTemplateId,
        )
      return this.requireById(meeting.id)
    })
  }

  findById(id: string): Meeting | null {
    const row = this.database.prepare('SELECT * FROM meetings WHERE id = ?').get(id) as
      | MeetingRow
      | undefined
    return row === undefined ? null : toMeeting(row)
  }

  requireById(id: string): Meeting {
    const meeting = this.findById(id)
    if (meeting === null) {
      throw new Error(`Meeting ${id} was not found`)
    }
    return meeting
  }

  listByStatuses(statuses: readonly Meeting['status'][]): Meeting[] {
    if (statuses.length === 0) return []
    const placeholders = statuses.map(() => '?').join(', ')
    const rows = this.database
      .prepare(`SELECT * FROM meetings WHERE status IN (${placeholders}) ORDER BY created_at, id`)
      .all(...statuses) as MeetingRow[]
    return rows.map(toMeeting)
  }

  listRecent(limit = 100): Meeting[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new Error('Recent meeting limit must be between 1 and 500')
    }
    const rows = this.database
      .prepare("SELECT * FROM meetings WHERE status != 'deleted' ORDER BY created_at DESC, id DESC LIMIT ?")
      .all(limit) as MeetingRow[]
    return rows.map(toMeeting)
  }

  replaceRecordingParts(meetingId: string, values: readonly RecordingPartInput[]): RecordingPart[] {
    const validated = values.map((value, index) => {
      if (value.partIndex !== index) throw new Error('Recording parts must use contiguous indices starting at zero')
      if (value.relativePath.length === 0 || value.relativePath === '.' || value.relativePath === '..' || /[\\/]/.test(value.relativePath)) {
        throw new Error('Recording part path must be a relative file name')
      }
      if (!Number.isSafeInteger(value.byteCount) || value.byteCount < 0) throw new Error('Recording part byte count must be a non-negative safe integer')
      if (!Number.isSafeInteger(value.durationMs) || value.durationMs < 0) throw new Error('Recording part duration must be a non-negative safe integer')
      return value
    })
    return inTransaction(this.database, () => {
      this.requireById(meetingId)
      this.database.prepare('DELETE FROM recording_parts WHERE meeting_id = ?').run(meetingId)
      const insert = this.database.prepare(
        'INSERT INTO recording_parts (meeting_id, part_index, relative_path, byte_count, duration_ms) VALUES (?, ?, ?, ?, ?)',
      )
      for (const value of validated) insert.run(meetingId, value.partIndex, value.relativePath, value.byteCount, value.durationMs)
      return this.listRecordingParts(meetingId)
    })
  }

  listRecordingParts(meetingId: string): RecordingPart[] {
    const rows = this.database.prepare(
      'SELECT * FROM recording_parts WHERE meeting_id = ? ORDER BY part_index',
    ).all(meetingId) as RecordingPartRow[]
    return rows.map((row) => ({
      meetingId: row.meeting_id,
      partIndex: row.part_index,
      relativePath: row.relative_path,
      byteCount: row.byte_count,
      durationMs: row.duration_ms,
    }))
  }

  deleteRecordingParts(meetingId: string): void {
    inTransaction(this.database, () => {
      this.requireById(meetingId)
      this.database.prepare('DELETE FROM recording_parts WHERE meeting_id = ?').run(meetingId)
    })
  }

  transitionRecordingStatus(id: string, status: 'recording' | 'recoverable'): Meeting {
    return inTransaction(this.database, () => {
      const meeting = this.requireById(id)
      if (meeting.status === status) return meeting
      assertMeetingTransition(meeting.status, status)
      this.database
        .prepare('UPDATE meetings SET status = ?, updated_at = ? WHERE id = ?')
        .run(status, new Date().toISOString(), id)
      return this.requireById(id)
    })
  }

  updateRecordingProgress(id: string, audioByteCount: number, durationMs: number): Meeting {
    if (!Number.isSafeInteger(audioByteCount) || audioByteCount < 0) {
      throw new Error('Recording byte count must be a non-negative safe integer')
    }
    if (!Number.isSafeInteger(durationMs) || durationMs < 0) {
      throw new Error('Recording duration must be a non-negative safe integer')
    }
    return inTransaction(this.database, () => {
      const meeting = this.requireById(id)
      if (meeting.status !== 'recording' && meeting.status !== 'recoverable') {
        throw new Error(`Meeting ${id} is not available for recording progress`)
      }
      this.database
        .prepare(
          `UPDATE meetings
           SET audio_byte_count = ?, duration_ms = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(audioByteCount, durationMs, new Date().toISOString(), id)
      return this.requireById(id)
    })
  }

  completeRecording(
    id: string,
    audioByteCount: number,
    durationMs: number,
    audioPath: string | null,
  ): Meeting {
    return inTransaction(this.database, () => {
      const meeting = this.requireById(id)
      assertMeetingTransition(meeting.status, 'recorded')
      this.database
        .prepare(
          `UPDATE meetings
           SET status = 'recorded', audio_byte_count = ?, duration_ms = ?,
               audio_path = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(audioByteCount, durationMs, audioPath, new Date().toISOString(), id)
      return this.requireById(id)
    })
  }

  discardRecording(id: string): Meeting {
    return inTransaction(this.database, () => {
      const meeting = this.requireById(id)
      assertMeetingTransition(meeting.status, 'deleted', { explicitDelete: true })
      this.database
        .prepare(
          `UPDATE meetings
           SET status = 'deleted', audio_path = NULL, audio_byte_count = 0, updated_at = ?
           WHERE id = ?`,
        )
        .run(new Date().toISOString(), id)
      return this.requireById(id)
    })
  }

  replaceTranscript(meetingId: string, values: readonly TranscriptSegment[]): TranscriptSegment[] {
    return inTransaction(this.database, () => {
      this.requireById(meetingId)
      this.database.prepare('DELETE FROM transcript_segments WHERE meeting_id = ?').run(meetingId)
      const insert = this.database.prepare(
        `INSERT INTO transcript_segments
          (id, meeting_id, speaker_id, start_ms, end_ms, text)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )

      for (const value of values) {
        const segment = TranscriptSegmentSchema.parse(value)
        if (segment.meetingId !== meetingId) {
          throw new Error('Transcript segment belongs to a different meeting')
        }
        insert.run(
          segment.id,
          segment.meetingId,
          segment.speakerId,
          segment.startMs,
          segment.endMs,
          segment.text,
        )
      }
      return this.listTranscript(meetingId)
    })
  }

  listTranscript(meetingId: string): TranscriptSegment[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM transcript_segments
         WHERE meeting_id = ? ORDER BY start_ms, end_ms, id`,
      )
      .all(meetingId) as TranscriptSegmentRow[]
    return rows.map(toTranscriptSegment)
  }

  listSpeakers(meetingId: string): Speaker[] {
    const rows = this.database
      .prepare('SELECT * FROM speakers WHERE meeting_id = ? ORDER BY id')
      .all(meetingId) as SpeakerRow[]
    return rows.map((row) =>
      SpeakerSchema.parse({
        id: row.id,
        meetingId: row.meeting_id,
        displayName: row.display_name,
      }),
    )
  }

  renameSpeaker(meetingId: string, speakerId: string, displayName: string): Speaker {
    const name = displayName.trim()
    if (name.length === 0) throw new Error('Speaker display name is required')
    return inTransaction(this.database, () => {
      const result = this.database
        .prepare('UPDATE speakers SET display_name = ? WHERE meeting_id = ? AND id = ?')
        .run(name, meetingId, speakerId)
      if (result.changes !== 1) throw new Error(`Speaker ${speakerId} was not found`)
      return this.listSpeakers(meetingId).find(({ id }) => id === speakerId)!
    })
  }

  replaceSummary(
    meetingId: string,
    sections: readonly Omit<StoredSummarySection, 'id' | 'meetingId'>[],
    actionItems: readonly Omit<StoredActionItem, 'id' | 'meetingId' | 'completed'>[],
  ): { sections: StoredSummarySection[]; actionItems: StoredActionItem[] } {
    return inTransaction(this.database, () => {
      this.requireById(meetingId)
      this.writeSummary(meetingId, sections, actionItems)
      return { sections: this.listSummarySections(meetingId), actionItems: this.listActionItems(meetingId) }
    })
  }

  completeSummary(
    meetingId: string,
    sections: readonly Omit<StoredSummarySection, 'id' | 'meetingId'>[],
    actionItems: readonly Omit<StoredActionItem, 'id' | 'meetingId' | 'completed'>[],
  ): { sections: StoredSummarySection[]; actionItems: StoredActionItem[] } {
    return inTransaction(this.database, () => {
      const meeting = this.requireById(meetingId)
      assertMeetingTransition(meeting.status, 'completed')
      this.writeSummary(meetingId, sections, actionItems)
      this.database.prepare("UPDATE meetings SET status = 'completed', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), meetingId)
      return { sections: this.listSummarySections(meetingId), actionItems: this.listActionItems(meetingId) }
    })
  }

  private writeSummary(
    meetingId: string,
    sections: readonly Omit<StoredSummarySection, 'id' | 'meetingId'>[],
    actionItems: readonly Omit<StoredActionItem, 'id' | 'meetingId' | 'completed'>[],
  ): void {
      this.database.prepare('DELETE FROM action_items WHERE meeting_id = ?').run(meetingId)
      this.database.prepare('DELETE FROM summary_sections WHERE meeting_id = ?').run(meetingId)
      const insertSection = this.database.prepare(
        `INSERT INTO summary_sections
          (id, meeting_id, template_section_id, kind, content_json, order_index)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      for (const value of sections) {
        const section = StoredSummarySectionSchema.parse({ ...value, id: randomUUID(), meetingId })
        insertSection.run(section.id, meetingId, section.templateSectionId, section.kind, JSON.stringify({ text: section.text, items: section.items }), section.orderIndex)
      }
      const insertAction = this.database.prepare(
        `INSERT INTO action_items
          (id, meeting_id, content, assignee_speaker_id, due_at, completed)
         VALUES (?, ?, ?, ?, ?, 0)`,
      )
      for (const value of actionItems) {
        const item = StoredActionItemSchema.parse({ ...value, id: randomUUID(), meetingId, completed: false })
        insertAction.run(item.id, meetingId, item.content, item.assigneeSpeakerId, item.dueAt)
      }
  }

  beginSummarization(meetingId: string): Meeting {
    return inTransaction(this.database, () => {
      const meeting = this.requireById(meetingId)
      if (meeting.status === 'summarizing') return meeting
      assertMeetingTransition(meeting.status, 'summarizing')
      this.database.prepare("UPDATE meetings SET status = 'summarizing', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), meetingId)
      return this.requireById(meetingId)
    })
  }

  beginProcessingAttempt(meetingId: string, stage: ProcessingStage | 'transcription', ownerId = 'legacy-owner'): ProcessingAttempt {
    this.requireById(meetingId)
    const active = this.database.prepare(
      'SELECT id FROM processing_attempts WHERE meeting_id = ? AND finished_at IS NULL',
    ).get(meetingId)
    if (active !== undefined) throw new ProcessingAttemptConflictError()
    const id = randomUUID()
    const startedAt = new Date().toISOString()
    this.database.prepare(
      `INSERT INTO processing_attempts (id, meeting_id, stage, started_at, finished_at, succeeded, sanitized_error, owner_id)
       VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?)`,
    ).run(id, meetingId, stage, startedAt, ownerId)
    return this.latestProcessingAttempt(meetingId)!
  }

  finishProcessingAttempt(
    id: string,
    outcome: { succeeded: true } | { succeeded: false; error: { code: string; message: string; retryable: boolean } },
  ): void {
    const result = this.database.prepare(
      `UPDATE processing_attempts SET finished_at = ?, succeeded = ?, sanitized_error = ?
       WHERE id = ? AND finished_at IS NULL`,
    ).run(
      new Date().toISOString(),
      outcome.succeeded ? 1 : 0,
      outcome.succeeded ? null : JSON.stringify(outcome.error),
      id,
    )
    if (result.changes !== 1) throw new Error('Processing attempt is not active')
  }

  latestProcessingAttempt(meetingId: string): ProcessingAttempt | null {
    const row = this.database.prepare(
      'SELECT * FROM processing_attempts WHERE meeting_id = ? ORDER BY rowid DESC LIMIT 1',
    ).get(meetingId) as ProcessingAttemptRow | undefined
    if (row === undefined) return null
    const stage = row.stage === 'transcription' ? 'transcribing' : row.stage
    if (!['transcribing', 'summarizing', 'cleanup'].includes(stage)) return null
    return {
      id: row.id,
      meetingId: row.meeting_id,
      stage: stage as ProcessingStage,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      succeeded: row.succeeded === null ? null : row.succeeded === 1,
      error: row.sanitized_error === null ? null : JSON.parse(row.sanitized_error),
      ownerId: row.owner_id,
    }
  }

  assertActiveProcessingAttempt(id: string, meetingId: string, stage: ProcessingStage, ownerId: string): void {
    const row = this.database.prepare(
      `SELECT id FROM processing_attempts
       WHERE id = ? AND meeting_id = ? AND stage = ? AND owner_id = ? AND finished_at IS NULL`,
    ).get(id, meetingId, stage, ownerId)
    if (row === undefined) throw new ProcessingAttemptConflictError()
  }

  reconcileInterruptedProcessing(currentOwnerId: string): void {
    inTransaction(this.database, () => {
      const rows = this.database.prepare(
        `SELECT id, meeting_id, stage FROM processing_attempts
         WHERE finished_at IS NULL AND (owner_id IS NULL OR owner_id <> ?)`,
      ).all(currentOwnerId) as Array<{ id: string; meeting_id: string; stage: string }>
      const error = JSON.stringify({
        code: 'PROCESSING_INTERRUPTED',
        message: 'Processing was interrupted. Try again.',
        retryable: true,
      })
      const cleanupError = JSON.stringify({
        code: 'AUDIO_CLEANUP_INTERRUPTED',
        message: 'Audio cleanup was interrupted. Try again.',
        retryable: true,
      })
      const now = new Date().toISOString()
      const needsSummaryRetry = new Set<string>()
      for (const row of rows) {
        const stage = row.stage === 'transcription' ? 'transcribing' : row.stage
        const meeting = this.requireById(row.meeting_id)
        const committed =
          (stage === 'transcribing' && (meeting.status === 'summarizing' || meeting.status === 'completed')) ||
          (stage === 'summarizing' && meeting.status === 'completed') ||
          (stage === 'cleanup' && meeting.status === 'completed' && meeting.audioPath === null)
        this.database.prepare(
          'UPDATE processing_attempts SET finished_at = ?, succeeded = ?, sanitized_error = ? WHERE id = ?',
        ).run(now, committed ? 1 : 0, committed ? null : stage === 'cleanup' ? cleanupError : error, row.id)
        if (committed && stage === 'transcribing' && meeting.status === 'summarizing') {
          needsSummaryRetry.add(meeting.id)
        } else if (!committed && meeting.status === stage) {
          this.database.prepare("UPDATE meetings SET status = 'failed', updated_at = ? WHERE id = ?")
            .run(now, meeting.id)
        }
      }

      for (const meetingId of needsSummaryRetry) {
        this.database.prepare(
          `INSERT INTO processing_attempts
            (id, meeting_id, stage, started_at, finished_at, succeeded, sanitized_error, owner_id)
           VALUES (?, ?, 'summarizing', ?, ?, 0, ?, ?)`,
        ).run(randomUUID(), meetingId, now, now, error, currentOwnerId)
        this.database.prepare("UPDATE meetings SET status = 'failed', updated_at = ? WHERE id = ?")
          .run(now, meetingId)
      }

      const cleanupMeetings = this.database.prepare(
        `SELECT id FROM meetings
         WHERE status = 'completed' AND audio_policy = 'delete_after_processing' AND audio_path IS NOT NULL`,
      ).all() as Array<{ id: string }>
      for (const meeting of cleanupMeetings) {
        const latestCleanup = this.database.prepare(
          `SELECT succeeded FROM processing_attempts
           WHERE meeting_id = ? AND stage = 'cleanup' ORDER BY rowid DESC LIMIT 1`,
        ).get(meeting.id) as { succeeded: number | null } | undefined
        if (latestCleanup?.succeeded === 0 || latestCleanup?.succeeded === null) continue
        this.database.prepare(
          `INSERT INTO processing_attempts
            (id, meeting_id, stage, started_at, finished_at, succeeded, sanitized_error, owner_id)
           VALUES (?, ?, 'cleanup', ?, ?, 0, ?, ?)`,
        ).run(randomUUID(), meeting.id, now, now, cleanupError, currentOwnerId)
      }
    })
  }

  failProcessing(meetingId: string): Meeting {
    return inTransaction(this.database, () => {
      const meeting = this.requireById(meetingId)
      if (meeting.status === 'failed') return meeting
      assertMeetingTransition(meeting.status, 'failed')
      this.database.prepare("UPDATE meetings SET status = 'failed', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), meetingId)
      return this.requireById(meetingId)
    })
  }

  completeAudioCleanup(meetingId: string, attemptId: string): Meeting {
    return inTransaction(this.database, () => {
      const meeting = this.requireById(meetingId)
      if (meeting.status !== 'completed') throw new Error('Audio cleanup requires completed processing')
      this.database.prepare('UPDATE meetings SET audio_path = NULL, audio_byte_count = 0, updated_at = ? WHERE id = ?')
        .run(new Date().toISOString(), meetingId)
      this.database.prepare('DELETE FROM recording_parts WHERE meeting_id = ?').run(meetingId)
      const result = this.database.prepare(
        `UPDATE processing_attempts SET finished_at = ?, succeeded = 1, sanitized_error = NULL
         WHERE id = ? AND meeting_id = ? AND stage = 'cleanup' AND finished_at IS NULL`,
      ).run(new Date().toISOString(), attemptId, meetingId)
      if (result.changes !== 1) throw new Error('Cleanup attempt is not active')
      return this.requireById(meetingId)
    })
  }

  updateAudioCleanupProgress(meetingId: string, remainingByteCount: number): Meeting {
    if (!Number.isSafeInteger(remainingByteCount) || remainingByteCount < 0) {
      throw new Error('Remaining audio byte count must be a non-negative safe integer')
    }
    return inTransaction(this.database, () => {
      const meeting = this.requireById(meetingId)
      if (meeting.status !== 'completed' || meeting.audioPath === null) {
        throw new Error('Audio cleanup progress requires retained completed audio')
      }
      this.database.prepare('UPDATE meetings SET audio_byte_count = ?, updated_at = ? WHERE id = ?')
        .run(remainingByteCount, new Date().toISOString(), meetingId)
      return this.requireById(meetingId)
    })
  }

  listSummarySections(meetingId: string): StoredSummarySection[] {
    const rows = this.database.prepare(
      'SELECT * FROM summary_sections WHERE meeting_id = ? ORDER BY order_index, id',
    ).all(meetingId) as SummarySectionRow[]
    return rows.map((row) => {
      const content = JSON.parse(row.content_json) as { text?: unknown; items?: unknown }
      return StoredSummarySectionSchema.parse({
        id: row.id,
        meetingId: row.meeting_id,
        templateSectionId: row.template_section_id,
        kind: row.kind,
        text: content.text,
        items: content.items,
        orderIndex: row.order_index,
      })
    })
  }

  listActionItems(meetingId: string): StoredActionItem[] {
    const rows = this.database.prepare(
      'SELECT * FROM action_items WHERE meeting_id = ? ORDER BY rowid',
    ).all(meetingId) as ActionItemRow[]
    return rows.map((row) => StoredActionItemSchema.parse({
      id: row.id,
      meetingId: row.meeting_id,
      content: row.content,
      assigneeSpeakerId: row.assignee_speaker_id,
      dueAt: row.due_at,
      completed: row.completed === 1,
    }))
  }

  beginTranscription(meetingId: string): Meeting {
    return inTransaction(this.database, () => {
      const meeting = this.requireById(meetingId)
      assertMeetingTransition(meeting.status, 'transcribing')
      this.database
        .prepare("UPDATE meetings SET status = 'transcribing', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), meetingId)
      return this.requireById(meetingId)
    })
  }

  completeTranscription(
    meetingId: string,
    speakers: readonly Speaker[],
    segments: readonly TranscriptSegment[],
  ): { speakers: Speaker[]; segments: TranscriptSegment[] } {
    return inTransaction(this.database, () => {
      const meeting = this.requireById(meetingId)
      assertMeetingTransition(meeting.status, 'summarizing')
      const upsertSpeaker = this.database.prepare(
        `INSERT INTO speakers (id, meeting_id, display_name) VALUES (?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      for (const value of speakers) {
        const speaker = SpeakerSchema.parse(value)
        if (speaker.meetingId !== meetingId) {
          throw new Error('Speaker belongs to a different meeting')
        }
        upsertSpeaker.run(speaker.id, speaker.meetingId, speaker.displayName)
      }

      this.database.prepare('DELETE FROM transcript_segments WHERE meeting_id = ?').run(meetingId)
      const insertSegment = this.database.prepare(
        `INSERT INTO transcript_segments (id, meeting_id, speaker_id, start_ms, end_ms, text)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      for (const value of segments) {
        const segment = TranscriptSegmentSchema.parse(value)
        if (segment.meetingId !== meetingId) {
          throw new Error('Transcript segment belongs to a different meeting')
        }
        insertSegment.run(
          segment.id,
          segment.meetingId,
          segment.speakerId,
          segment.startMs,
          segment.endMs,
          segment.text,
        )
      }
      this.database
        .prepare("UPDATE meetings SET status = 'summarizing', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), meetingId)
      return { speakers: this.listSpeakers(meetingId), segments: this.listTranscript(meetingId) }
    })
  }

  failTranscription(
    meetingId: string,
    error: { code: string; message: string; retryable: boolean },
  ): Meeting {
    return inTransaction(this.database, () => {
      const meeting = this.requireById(meetingId)
      assertMeetingTransition(meeting.status, 'failed')
      const now = new Date().toISOString()
      this.database
        .prepare("UPDATE meetings SET status = 'failed', updated_at = ? WHERE id = ?")
        .run(now, meetingId)
      const active = this.database.prepare(
        `SELECT id FROM processing_attempts
         WHERE meeting_id = ? AND stage IN ('transcribing', 'transcription') AND finished_at IS NULL
         ORDER BY rowid DESC LIMIT 1`,
      ).get(meetingId)
      if (active === undefined) {
        this.database.prepare(
          `INSERT INTO processing_attempts
            (id, meeting_id, stage, started_at, finished_at, succeeded, sanitized_error)
           VALUES (?, ?, 'transcription', ?, ?, 0, ?)`,
        ).run(randomUUID(), meetingId, now, now, JSON.stringify(error))
      }
      return this.requireById(meetingId)
    })
  }
}
