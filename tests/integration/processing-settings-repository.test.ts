import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db/database'
import { registerSettingsHandlers } from '../../src/main/ipc/registerSettingsHandlers'
import { ProcessingSettingsRepository } from '../../src/main/settings/processingSettingsRepository'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function temporaryDatabasePath(): string {
  const root = mkdtempSync(join(tmpdir(), 'nnote-processing-settings-'))
  roots.push(root)
  return join(root, 'nnote.sqlite')
}

describe('processing settings repository', () => {
  it('defaults existing databases to OpenAI providers without changing existing rows', () => {
    const path = temporaryDatabasePath()
    const existing = new Database(path)
    existing.exec(`
      CREATE TABLE existing_data (value TEXT NOT NULL);
      INSERT INTO existing_data VALUES ('preserve-me');
      CREATE TABLE action_items (id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, content TEXT NOT NULL, assignee_speaker_id TEXT, due_at TEXT, completed INTEGER NOT NULL DEFAULT 0);
      PRAGMA user_version = 2;
    `)
    existing.close()

    const database = openDatabase(path)
    const settings = new ProcessingSettingsRepository(database)

    expect(settings.get()).toEqual({
      transcriptionProvider: 'openai',
      summaryProvider: 'openai',
      localWhisperModel: 'base',
    })
    expect(database.prepare('SELECT value FROM existing_data').pluck().get()).toBe('preserve-me')
    expect(database.pragma('user_version', { simple: true })).toBe(4)
    database.close()
  })

  it('returns an independent default value after a caller mutates an earlier fallback', () => {
    const database = openDatabase(temporaryDatabasePath())
    const settings = new ProcessingSettingsRepository(database)
    database.prepare('UPDATE app_settings SET value_json = ? WHERE key = ?')
      .run('{"transcriptionProvider":"invalid"}', 'processing_providers')
    const first = settings.get()

    first.transcriptionProvider = 'local_whisper'
    first.summaryProvider = 'codex_cli'
    first.localWhisperModel = 'small'

    expect(settings.get()).toEqual({
      transcriptionProvider: 'openai',
      summaryProvider: 'openai',
      localWhisperModel: 'base',
    })
    expect(database.prepare('SELECT value_json FROM app_settings WHERE key = ?').pluck().get('processing_providers'))
      .toBe('{"transcriptionProvider":"invalid"}')
    database.close()
  })

  it('persists only known provider IDs and reconciles invalid stored values', () => {
    const database = openDatabase(temporaryDatabasePath())
    const settings = new ProcessingSettingsRepository(database)

    expect(settings.update({
      transcriptionProvider: 'local_whisper',
      summaryProvider: 'codex_cli',
      localWhisperModel: 'small',
    })).toEqual({
      transcriptionProvider: 'local_whisper',
      summaryProvider: 'codex_cli',
      localWhisperModel: 'small',
    })
    database.prepare('UPDATE app_settings SET value_json = ? WHERE key = ?')
      .run('{"transcriptionProvider":"bad"}', 'processing_providers')

    expect(settings.get()).toEqual({
      transcriptionProvider: 'openai',
      summaryProvider: 'openai',
      localWhisperModel: 'base',
    })
    database.close()
  })

  it('reconciles Codex CLI settings to OpenAI when the build disables Codex', () => {
    const database = openDatabase(temporaryDatabasePath())
    const settings = new ProcessingSettingsRepository(database, { codexCliEnabled: false })

    database.prepare('UPDATE app_settings SET value_json = ? WHERE key = ?')
      .run(JSON.stringify({
        transcriptionProvider: 'local_whisper',
        summaryProvider: 'codex_cli',
        localWhisperModel: 'small',
      }), 'processing_providers')

    expect(settings.get()).toEqual({
      transcriptionProvider: 'local_whisper',
      summaryProvider: 'openai',
      localWhisperModel: 'small',
    })
    expect(settings.update({
      transcriptionProvider: 'openai',
      summaryProvider: 'codex_cli',
      localWhisperModel: 'base',
    })).toEqual({
      transcriptionProvider: 'openai',
      summaryProvider: 'openai',
      localWhisperModel: 'base',
    })
    expect(database.prepare('SELECT value_json FROM app_settings WHERE key = ?').pluck().get('processing_providers'))
      .toBe('{"transcriptionProvider":"openai","summaryProvider":"openai","localWhisperModel":"base"}')
    database.close()
  })

  it('forces OpenAI processing when the App Store build disables local Whisper and Codex', () => {
    const database = openDatabase(temporaryDatabasePath())
    const settings = new ProcessingSettingsRepository(database, {
      codexCliEnabled: false,
      localWhisperEnabled: false,
    })

    expect(settings.update({
      transcriptionProvider: 'local_whisper',
      summaryProvider: 'codex_cli',
      localWhisperModel: 'small',
    })).toEqual({
      transcriptionProvider: 'openai',
      summaryProvider: 'openai',
      localWhisperModel: 'small',
    })
    expect(settings.get()).toEqual({
      transcriptionProvider: 'openai',
      summaryProvider: 'openai',
      localWhisperModel: 'small',
    })
    database.close()
  })

  it('preserves Apple selections when MAS disables Whisper and Codex', () => {
    const database = openDatabase(temporaryDatabasePath())
    const settings = new ProcessingSettingsRepository(database, {
      codexCliEnabled: false,
      localWhisperEnabled: false,
    })
    const selected = {
      transcriptionProvider: 'apple_speech' as const,
      summaryProvider: 'apple_foundation' as const,
      localWhisperModel: 'base' as const,
    }
    expect(settings.update(selected)).toEqual(selected)
    expect(settings.get()).toEqual(selected)
    database.close()
  })

  it('validates processing provider settings at the IPC boundary', async () => {
    const database = openDatabase(temporaryDatabasePath())
    const settings = new ProcessingSettingsRepository(database)
    const handlers = new Map<string, (...args: unknown[]) => unknown>()

    registerSettingsHandlers(
      { handle: (channel, handler) => handlers.set(channel, handler) },
      { get: async () => null, set: async () => undefined, delete: async () => undefined },
      { validate: async () => undefined },
      settings,
      { descriptors: async () => [] },
      { list: async () => [], download: async () => { throw new Error() }, delete: async () => { throw new Error() }, onProgress: () => () => undefined },
      () => undefined,
    )

    await expect(handlers.get('settings:update-processing-providers')?.({}, {
      transcriptionProvider: 'bad',
      summaryProvider: 'codex_cli',
      localWhisperModel: 'small',
    })).rejects.toThrow()
    await expect(handlers.get('settings:get-processing-providers')?.({})).resolves.toEqual({
      transcriptionProvider: 'openai',
      summaryProvider: 'openai',
      localWhisperModel: 'base',
    })

    database.close()
  })
})
