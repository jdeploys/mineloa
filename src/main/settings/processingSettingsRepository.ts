import type Database from 'better-sqlite3'
import {
  ProcessingProviderSettingsSchema,
  type ProcessingProviderSettings,
} from '../../shared/contracts/settings'

const defaultProcessingProviderSettings: ProcessingProviderSettings = {
  transcriptionProvider: 'openai',
  summaryProvider: 'openai',
  localWhisperModel: 'base',
}

interface ProcessingSettingsRepositoryOptions {
  readonly codexCliEnabled?: boolean
  readonly localWhisperEnabled?: boolean
}

export class ProcessingSettingsRepository {
  private readonly codexCliEnabled: boolean
  private readonly localWhisperEnabled: boolean

  constructor(
    private readonly database: Database.Database,
    options: ProcessingSettingsRepositoryOptions = {},
  ) {
    this.codexCliEnabled = options.codexCliEnabled ?? true
    this.localWhisperEnabled = options.localWhisperEnabled ?? true
  }

  get(): ProcessingProviderSettings {
    const row = this.database.prepare('SELECT value_json FROM app_settings WHERE key = ?')
      .get('processing_providers') as { value_json: string } | undefined
    let stored: unknown = null
    try {
      stored = row === undefined ? null : JSON.parse(row.value_json)
    } catch {
      stored = null
    }
    const parsed = ProcessingProviderSettingsSchema.safeParse(stored)
    return this.reconcile(
      parsed.success ? parsed.data : { ...defaultProcessingProviderSettings },
    )
  }

  update(input: ProcessingProviderSettings): ProcessingProviderSettings {
    const value = this.reconcile(ProcessingProviderSettingsSchema.parse(input))
    this.database.prepare(`
      INSERT INTO app_settings(key, value_json) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
    `).run('processing_providers', JSON.stringify(value))
    return value
  }

  private reconcile(value: ProcessingProviderSettings): ProcessingProviderSettings {
    return {
      ...value,
      transcriptionProvider: !this.localWhisperEnabled && value.transcriptionProvider === 'local_whisper' ? 'openai' : value.transcriptionProvider,
      summaryProvider: !this.codexCliEnabled && value.summaryProvider === 'codex_cli' ? 'openai' : value.summaryProvider,
    }
  }
}
