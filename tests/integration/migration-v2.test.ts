import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runMigrations } from '../../src/main/db/migrations'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('migration 2', () => {
  it('finishes older duplicate v1 active attempts safely before adding the unique lease index', () => {
    const root = mkdtempSync(join(tmpdir(), 'nnote-migration-v2-'))
    roots.push(root)
    const db = new Database(join(root, 'v1.sqlite'))
    db.exec(`
      CREATE TABLE meetings (id TEXT PRIMARY KEY, status TEXT NOT NULL);
      INSERT INTO meetings VALUES ('m1', 'summarizing'), ('m2', 'transcribing');
      CREATE TABLE processing_attempts (
        id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, stage TEXT NOT NULL,
        started_at TEXT NOT NULL, finished_at TEXT, succeeded INTEGER,
        sanitized_error TEXT
      );
      INSERT INTO processing_attempts VALUES
        ('old', 'm1', 'transcribing', '2026-01-01T00:00:00.000Z', NULL, NULL, NULL),
        ('new', 'm1', 'summarizing', '2026-01-02T00:00:00.000Z', NULL, NULL, NULL),
        ('same-time-older-row', 'm2', 'transcribing', '2026-01-03T00:00:00.000Z', NULL, NULL, NULL),
        ('same-time-newer-row', 'm2', 'summarizing', '2026-01-03T00:00:00.000Z', NULL, NULL, NULL),
        ('history', 'm1', 'transcription', '2025-01-01T00:00:00.000Z', '2025-01-01T00:01:00.000Z', 0, '{"code":"OLD"}');
      PRAGMA user_version = 1;
    `)

    runMigrations(db)

    const rows = db.prepare('SELECT id, finished_at, succeeded, sanitized_error FROM processing_attempts ORDER BY rowid').all() as Array<any>
    expect(rows.filter(({ finished_at }) => finished_at === null).map(({ id }) => id)).toEqual(['new', 'same-time-older-row'])
    for (const id of ['old', 'same-time-newer-row']) {
      const row = rows.find((value) => value.id === id)
      expect(row).toMatchObject({ succeeded: 0, finished_at: expect.any(String) })
      expect(JSON.parse(row.sanitized_error)).toEqual({ code: 'PROCESSING_INTERRUPTED', message: 'Processing was interrupted. Try again.', retryable: true })
    }
    expect(rows.find(({ id }) => id === 'history')).toMatchObject({ sanitized_error: '{"code":"OLD"}' })
    expect(db.pragma('user_version', { simple: true })).toBe(2)
    expect(() => db.prepare(`INSERT INTO processing_attempts (id, meeting_id, stage, started_at) VALUES ('duplicate', 'm1', 'cleanup', '2026-01-04')`).run()).toThrow()
    db.close()
  })
})
