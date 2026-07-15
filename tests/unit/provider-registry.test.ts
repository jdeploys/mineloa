import { describe, expect, it } from 'vitest'
import { ProviderRegistry } from '../../src/main/ai/providers/providerRegistry'
import type {
  ProviderDescriptor,
  SummaryProvider,
  TranscriptionProvider,
} from '../../src/main/ai/providers/providerPorts'
import { registerSettingsHandlers } from '../../src/main/ipc/registerSettingsHandlers'

function descriptor(
  id: ProviderDescriptor['id'],
  stage: ProviderDescriptor['stage'],
): ProviderDescriptor {
  return {
    id,
    stage,
    displayName: id,
    availability: { available: true, code: null, message: null },
    privacy: stage === 'transcription' ? 'audio_cloud' : 'text_cloud',
    capabilities: [],
  }
}

const openAiTranscription: TranscriptionProvider = {
  id: 'openai',
  descriptor: async () => descriptor('openai', 'transcription'),
  availability: async () => ({ available: true, code: null, message: null }),
  transcribe: async () => ({ durationSeconds: 0, segments: [] }),
}
const localTranscription: TranscriptionProvider = {
  ...openAiTranscription,
  id: 'local_whisper',
  descriptor: async () => descriptor('local_whisper', 'transcription'),
}
const openAiSummary: SummaryProvider = {
  id: 'openai',
  descriptor: async () => descriptor('openai', 'summary'),
  availability: async () => ({ available: true, code: null, message: null }),
  summarize: async () => '{}',
}
const codexSummary: SummaryProvider = {
  ...openAiSummary,
  id: 'codex_cli',
  descriptor: async () => descriptor('codex_cli', 'summary'),
}

function createRegistry() {
  return new ProviderRegistry([openAiTranscription], [openAiSummary])
}

describe('ProviderRegistry', () => {
  it('resolves each registered stable provider ID exactly once', () => {
    const registry = new ProviderRegistry(
      [openAiTranscription, localTranscription],
      [openAiSummary, codexSummary],
    )
    expect(registry.transcription('local_whisper')).toBe(localTranscription)
    expect(registry.summary('codex_cli')).toBe(codexSummary)
  })

  it('rejects duplicate IDs at composition time', () => {
    expect(() => new ProviderRegistry(
      [openAiTranscription, openAiTranscription],
      [openAiSummary],
    )).toThrow(/duplicate transcription provider/i)
  })

  it('rejects unknown runtime IDs instead of silently selecting another provider', () => {
    expect(() => createRegistry().transcription('unknown' as never))
      .toThrow(/unknown transcription provider/i)
  })

  it('flattens adapter descriptors without inspecting provider IDs', async () => {
    const registry = new ProviderRegistry(
      [localTranscription, openAiTranscription],
      [codexSummary, openAiSummary],
    )
    await expect(registry.descriptors()).resolves.toEqual([
      descriptor('local_whisper', 'transcription'),
      descriptor('openai', 'transcription'),
      descriptor('codex_cli', 'summary'),
      descriptor('openai', 'summary'),
    ])
  })

  it('always registers the settings descriptor handler from its required dependency', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const registry = createRegistry()
    registerSettingsHandlers(
      { handle: (channel, handler) => handlers.set(channel, handler) },
      { get: async () => null, set: async () => undefined, delete: async () => undefined },
      { validate: async () => undefined },
      {
        get: () => ({ transcriptionProvider: 'openai', summaryProvider: 'openai', localWhisperModel: 'base' }),
        update: (input) => input,
      },
      registry,
    )

    expect(handlers.has('settings:list-processing-provider-descriptors')).toBe(true)
    await expect(handlers.get('settings:list-processing-provider-descriptors')?.({}))
      .resolves.toEqual([
        descriptor('openai', 'transcription'),
        descriptor('openai', 'summary'),
      ])
  })
})
