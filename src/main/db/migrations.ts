import type Database from 'better-sqlite3'

const migration1 = `
  CREATE TABLE meetings (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
    status TEXT NOT NULL CHECK (status IN (
      'draft', 'recording', 'recoverable', 'recorded', 'transcribing',
      'summarizing', 'completed', 'failed', 'deleted'
    )),
    audio_policy TEXT NOT NULL CHECK (audio_policy IN ('keep', 'delete_after_processing')),
    audio_path TEXT,
    audio_byte_count INTEGER NOT NULL CHECK (audio_byte_count >= 0),
    selected_template_id TEXT REFERENCES summary_templates(id) ON DELETE SET NULL
  );

  CREATE TABLE recording_parts (
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    part_index INTEGER NOT NULL CHECK (part_index >= 0),
    relative_path TEXT NOT NULL,
    byte_count INTEGER NOT NULL CHECK (byte_count >= 0),
    duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
    PRIMARY KEY (meeting_id, part_index)
  );

  CREATE TABLE speakers (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    UNIQUE (meeting_id, id)
  );

  CREATE TABLE transcript_segments (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    speaker_id TEXT,
    start_ms INTEGER NOT NULL CHECK (start_ms >= 0),
    end_ms INTEGER NOT NULL CHECK (end_ms >= start_ms),
    text TEXT NOT NULL,
    FOREIGN KEY (meeting_id, speaker_id) REFERENCES speakers(meeting_id, id)
  );

  CREATE INDEX transcript_segments_meeting_time
    ON transcript_segments(meeting_id, start_ms, end_ms);

  CREATE TABLE summary_sections (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    template_section_id TEXT,
    kind TEXT NOT NULL,
    content_json TEXT NOT NULL,
    order_index INTEGER NOT NULL CHECK (order_index >= 0)
  );

  CREATE TABLE action_items (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    assignee_speaker_id TEXT,
    due_at TEXT,
    completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
    FOREIGN KEY (meeting_id, assignee_speaker_id) REFERENCES speakers(meeting_id, id)
  );

  CREATE TABLE summary_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sections_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE processing_attempts (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    stage TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    succeeded INTEGER CHECK (succeeded IN (0, 1)),
    sanitized_error TEXT
  );

  PRAGMA user_version = 1;
`

const migration2 = `
  ALTER TABLE processing_attempts ADD COLUMN owner_id TEXT;
`

const finishDuplicateAttempt = `
  UPDATE processing_attempts
  SET finished_at = ?, succeeded = 0, sanitized_error = ?
  WHERE id = ?
`

export function runMigrations(database: Database.Database): void {
  const version = database.pragma('user_version', { simple: true }) as number
  if (version > 2) {
    throw new Error(`Database version ${version} is newer than supported version 2`)
  }
  if (version === 0) {
    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(migration1)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
  if ((database.pragma('user_version', { simple: true }) as number) === 1) {
    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(migration2)
      const active = database.prepare(
        `SELECT p.id, p.meeting_id
         FROM processing_attempts p
         JOIN meetings m ON m.id = p.meeting_id
         WHERE p.finished_at IS NULL
         ORDER BY p.meeting_id,
           CASE WHEN
             (p.stage IN ('transcribing', 'transcription') AND m.status = 'transcribing') OR
             (p.stage = 'summarizing' AND m.status = 'summarizing') OR
             (p.stage = 'cleanup' AND m.status = 'completed')
           THEN 0 ELSE 1 END,
           p.started_at DESC, p.rowid DESC`,
      ).all() as Array<{ id: string; meeting_id: string }>
      const seen = new Set<string>()
      const now = new Date().toISOString()
      const interrupted = JSON.stringify({
        code: 'PROCESSING_INTERRUPTED',
        message: 'Processing was interrupted. Try again.',
        retryable: true,
      })
      const finish = database.prepare(finishDuplicateAttempt)
      for (const attempt of active) {
        if (seen.has(attempt.meeting_id)) finish.run(now, interrupted, attempt.id)
        else seen.add(attempt.meeting_id)
      }
      database.exec(`
        CREATE UNIQUE INDEX processing_attempts_one_active_per_meeting
          ON processing_attempts(meeting_id) WHERE finished_at IS NULL;
        PRAGMA user_version = 2;
      `)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
}
