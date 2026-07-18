import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../../src/main/db/database'
import { MeetingRepository } from '../../src/main/db/meetingRepository'
import type { CredentialStore } from '../../src/main/credentials/credentialStore'
import { OpenAiGateway, type OpenAiTranscriptionClient } from '../../src/main/ai/openAiGateway'
import { OpenAiError, toOpenAiError } from '../../src/main/ai/openAiErrors'
import { TranscriptionService } from '../../src/main/ai/transcriptionService'
import { OpenAiTranscriptionAdapter } from '../../src/main/ai/providers/openAiTranscriptionAdapter'
import { LocalWhisperTranscriptionAdapter } from '../../src/main/ai/providers/localWhisperTranscriptionAdapter'
import { ProviderRegistry } from '../../src/main/ai/providers/providerRegistry'
import { safeProviderError, toProviderError } from '../../src/main/ai/providers/providerErrors'
import { completedPartPath } from '../../src/main/recording/recordingPaths'
import type { Meeting } from '../../src/shared/contracts/meeting'

const directories: string[] = []

function harness(status: Meeting['status'] = 'recorded') {
  const root = mkdtempSync(join(tmpdir(), 'nnote-transcription-'))
  directories.push(root)
  const recordingsDirectory = join(root, 'recordings')
  mkdirSync(recordingsDirectory)
  const database = openDatabase(join(root, 'nnote.sqlite'))
  const meetings = new MeetingRepository(database)
  meetings.create({
    id: 'meeting-1',
    title: 'Planning',
    createdAt: '2026-07-14T12:00:00.000Z',
    updatedAt: '2026-07-14T12:00:00.000Z',
    durationMs: 12_000,
    status,
    audioPolicy: 'delete_after_processing',
    audioPath: basename(completedPartPath(recordingsDirectory, 'meeting-1', 0)),
    audioByteCount: 6,
    selectedTemplateId: null,
  })
  return { root, recordingsDirectory, database, meetings }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('OpenAiGateway', () => {
  it('adapts the neutral request and speaker labels without leaking gateway request details', async () => {
    const gateway = {
      transcribe: vi.fn(async () => ({
        durationSeconds: 1,
        segments: [{ speaker: 'A', startSeconds: 0, endSeconds: 1, text: 'Hello' }],
      })),
    }
    const adapter = new OpenAiTranscriptionAdapter(gateway)

    await expect(adapter.transcribe({ filePath: 'meeting.webm', recordingDurationSeconds: 99 })).resolves.toEqual({
      durationSeconds: 1,
      segments: [{ speakerLabel: 'A', startSeconds: 0, endSeconds: 1, text: 'Hello' }],
    })
    expect(gateway.transcribe).toHaveBeenCalledWith({
      filePath: 'meeting.webm',
      recordingDurationSeconds: 99,
      model: 'gpt-4o-transcribe-diarize',
      responseFormat: 'diarized_json',
      chunkingStrategy: 'auto',
    })
  })

  it('selecting OpenAI from the Registry never invokes a packaged process runner', async () => {
    const runOwnedProcess = vi.fn()
    const gateway = { transcribe: vi.fn(async () => ({ durationSeconds: 1, segments: [] })) }
    const openAi = new OpenAiTranscriptionAdapter(gateway)
    const localWhisper = new LocalWhisperTranscriptionAdapter({
      resolveRuntimePaths: async () => ({ whisperPath: 'whisper-cli', ffmpegPath: 'ffmpeg' }),
      verifiedModelPath: async () => 'ggml-base.bin',
      resolveModel: () => 'base',
      recordingsRoot: 'recordings',
      temporaryRoot: 'temporary',
      runProcess: runOwnedProcess,
    })
    const registry = new ProviderRegistry([openAi, localWhisper], [])

    await registry.transcription('openai').transcribe({ filePath: 'meeting.webm', recordingDurationSeconds: 1 })

    expect(gateway.transcribe).toHaveBeenCalledOnce()
    expect(runOwnedProcess).not.toHaveBeenCalled()
  })

  it('maps a raw OpenAI gateway failure through the adapter without leaking its canary', async () => {
    const adapter = new OpenAiTranscriptionAdapter({
      transcribe: vi.fn(async () => { throw Object.assign(new Error('adapter canary secret'), { status: 401 }) }),
    })

    const failure = await adapter.transcribe({ filePath: 'meeting.webm' }).catch((error: unknown) => error)

    expect(failure).toMatchObject({ code: 'OPENAI_UNAUTHORIZED', message: 'OpenAI rejected the API key.', retryable: false })
    expect(String(failure)).not.toContain('adapter canary secret')
  })

  it('uses the exact SDK request shape and retrieves the credential for every call', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nnote-gateway-'))
    directories.push(root)
    const firstPath = join(root, 'meeting.webm')
    const secondPath = join(root, 'meeting-2.webm')
    writeFileSync(firstPath, Buffer.from([1]))
    writeFileSync(secondPath, Buffer.from([2]))
    const credentials: CredentialStore = {
      get: vi.fn().mockResolvedValue('sk-test-secret'),
      set: vi.fn(),
      delete: vi.fn(),
    }
    const create = vi.fn(async (input: unknown) => {
      const file = (input as { file: AsyncIterable<unknown> }).file
      for await (const _chunk of file) { /* consume the SDK upload stream */ }
      return { duration: 1, segments: [] }
    })
    const factory = vi.fn((): OpenAiTranscriptionClient => ({
      audio: { transcriptions: { create } },
    }))
    const gateway = new OpenAiGateway(credentials, factory)

    await gateway.transcribe({
      filePath: firstPath,
      model: 'gpt-4o-transcribe-diarize',
      responseFormat: 'diarized_json',
      chunkingStrategy: 'auto',
    })
    await gateway.transcribe({
      filePath: secondPath,
      model: 'gpt-4o-transcribe-diarize',
      responseFormat: 'diarized_json',
      chunkingStrategy: 'auto',
    })

    expect(credentials.get).toHaveBeenCalledTimes(2)
    expect(factory).toHaveBeenNthCalledWith(1, 'sk-test-secret')
    expect(create).toHaveBeenNthCalledWith(1, {
      file: expect.objectContaining({ path: firstPath }),
      model: 'gpt-4o-transcribe-diarize',
      response_format: 'diarized_json',
      chunking_strategy: 'auto',
    })
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('responseFormat')
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('chunkingStrategy')
  })

  it('rejects a malformed provider payload with a fixed safe error', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nnote-gateway-invalid-'))
    directories.push(root)
    const filePath = join(root, 'meeting.webm')
    writeFileSync(filePath, Buffer.from([1]))
    const credentials: CredentialStore = {
      get: vi.fn().mockResolvedValue('placeholder'),
      set: vi.fn(),
      delete: vi.fn(),
    }
    const create = vi.fn(async (input: unknown) => {
      for await (const _chunk of (input as { file: AsyncIterable<unknown> }).file) {
        // consume the upload stream
      }
      return { duration: 'provider canary 719', segments: [] }
    })
    const gateway = new OpenAiGateway(credentials, () => ({
      audio: { transcriptions: { create } },
    }))

    await expect(gateway.transcribe({
      filePath,
      model: 'gpt-4o-transcribe-diarize',
      responseFormat: 'diarized_json',
      chunkingStrategy: 'auto',
    })).rejects.toMatchObject({
      code: 'OPENAI_MALFORMED_RESPONSE',
      message: 'OpenAI returned an invalid transcription response.',
    })
  })

  it('uses the durable recording duration when a valid diarized response omits duration', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nnote-gateway-duration-'))
    directories.push(root)
    const filePath = join(root, 'meeting.webm')
    writeFileSync(filePath, Buffer.from([1]))
    const create = vi.fn(async (input: unknown) => {
      for await (const _chunk of (input as { file: AsyncIterable<unknown> }).file) {
        // consume the upload stream
      }
      return {
        text: 'Hello',
        segments: [{
          type: 'transcript.text.segment', id: 'seg_001', speaker: 'A',
          start: 0, end: 1, text: 'Hello',
        }],
        usage: { type: 'tokens', input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      }
    })
    const gateway = new OpenAiGateway(
      { get: vi.fn().mockResolvedValue('placeholder'), set: vi.fn(), delete: vi.fn() },
      () => ({ audio: { transcriptions: { create } } }),
    )

    await expect(gateway.transcribe({
      filePath,
      recordingDurationSeconds: 31.792,
      model: 'gpt-4o-transcribe-diarize',
      responseFormat: 'diarized_json',
      chunkingStrategy: 'auto',
    })).resolves.toEqual({
      durationSeconds: 31.792,
      segments: [{ speaker: 'A', startSeconds: 0, endSeconds: 1, text: 'Hello' }],
    })
    expect(create).toHaveBeenCalledWith(expect.not.objectContaining({ recordingDurationSeconds: expect.anything() }))
  })

  it('never rethrows a raw SDK error message', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nnote-gateway-error-'))
    directories.push(root)
    const filePath = join(root, 'meeting.webm')
    writeFileSync(filePath, Buffer.from([1]))
    const create = vi.fn(async (input: unknown) => {
      for await (const _chunk of (input as { file: AsyncIterable<unknown> }).file) {
        // consume the upload stream
      }
      throw Object.assign(new Error('provider canary gateway 883'), { status: 401 })
    })
    const gateway = new OpenAiGateway(
      { get: vi.fn().mockResolvedValue('placeholder'), set: vi.fn(), delete: vi.fn() },
      () => ({ audio: { transcriptions: { create } } }),
    )

    const failure = await gateway.transcribe({
      filePath,
      model: 'gpt-4o-transcribe-diarize',
      responseFormat: 'diarized_json',
      chunkingStrategy: 'auto',
    }).catch((error: unknown) => error)

    expect(failure).toMatchObject({
      code: 'OPENAI_UNAUTHORIZED',
      message: 'OpenAI rejected the API key.',
    })
    expect(String(failure)).not.toContain('provider canary gateway 883')
  })

  it('keeps HTTP 400 classified as invalid audio at the transcription gateway', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nnote-gateway-invalid-audio-'))
    directories.push(root)
    const filePath = join(root, 'meeting.webm')
    writeFileSync(filePath, Buffer.from([1]))
    const gateway = new OpenAiGateway(
      { get: vi.fn().mockResolvedValue('placeholder'), set: vi.fn(), delete: vi.fn() },
      () => ({ audio: { transcriptions: { create: vi.fn(async (input: unknown) => {
        for await (const _chunk of (input as { file: AsyncIterable<unknown> }).file) {
          // consume the upload stream before returning the provider failure
        }
        throw Object.assign(new Error('provider canary invalid audio'), { status: 400 })
      }) } } }),
    )

    await expect(gateway.transcribe({
      filePath,
      model: 'gpt-4o-transcribe-diarize',
      responseFormat: 'diarized_json',
      chunkingStrategy: 'auto',
    })).rejects.toMatchObject({
      code: 'OPENAI_INVALID_AUDIO',
      message: 'OpenAI could not process this audio file.',
      retryable: false,
    })
  })
})

describe('toOpenAiError', () => {
  it.each([
    ['401', Object.assign(new Error('provider canary 401'), { status: 401 }), 'OPENAI_UNAUTHORIZED', 'OpenAI rejected the API key.'],
    ['429', Object.assign(new Error('provider canary 429'), { status: 429 }), 'OPENAI_RATE_LIMITED', 'OpenAI rate limit was reached. Try again later.'],
    ['timeout', Object.assign(new Error('provider canary timeout'), { name: 'APIConnectionTimeoutError' }), 'OPENAI_TIMEOUT', 'The OpenAI request timed out. Try again.'],
    ['network', Object.assign(new Error('provider canary network'), { name: 'APIConnectionError' }), 'OPENAI_NETWORK', 'Could not reach OpenAI. Check the network connection and try again.'],
    ['invalid audio', Object.assign(new Error('provider canary audio'), { status: 400 }), 'OPENAI_INVALID_AUDIO', 'OpenAI could not process this audio file.'],
    ['malformed', new OpenAiError('OPENAI_MALFORMED_RESPONSE', 'provider canary malformed', false), 'OPENAI_MALFORMED_RESPONSE', 'OpenAI returned an invalid transcription response.'],
    ['unknown', new Error('provider canary unknown'), 'OPENAI_UNKNOWN', 'OpenAI transcription failed.'],
  ])('maps %s to a fixed safe classification', (_label, input, code, message) => {
    const result = toOpenAiError(input)

    expect(result).toMatchObject({ code, message })
    expect(result.message).not.toContain('provider canary')
  })
})

describe('TranscriptionService', () => {
  it('finishes its active attempt when the initial transcription transition throws', async () => {
    const h = harness()
    writeFileSync(completedPartPath(h.recordingsDirectory, 'meeting-1', 0), Buffer.from([1]))
    const begin = vi.spyOn(h.meetings, 'beginTranscription').mockImplementationOnce(() => { throw new Error('forced transition failure') })
    const gateway = { transcribe: vi.fn(async () => ({ durationSeconds: 1, segments: [] })) }
    const service = new TranscriptionService(h.meetings, () => gateway, h.recordingsDirectory)
    await expect(service.transcribeMeeting('meeting-1')).rejects.toMatchObject({ code: 'TRANSCRIPTION_PROVIDER_UNKNOWN' })
    expect(gateway.transcribe).not.toHaveBeenCalled()
    expect(h.meetings.latestProcessingAttempt('meeting-1')).toMatchObject({ succeeded: false, finishedAt: expect.any(String) })
    begin.mockRestore()
    await expect(service.transcribeMeeting('meeting-1')).resolves.toBeDefined()
    h.database.close()
  })
  it('transcribes finalized parts in order using canonical macOS-safe paths and normalizes stable part-scoped speakers', async () => {
    const h = harness()
    const second = completedPartPath(h.recordingsDirectory, 'meeting-1', 1)
    const first = completedPartPath(h.recordingsDirectory, 'meeting-1', 0)
    writeFileSync(second, Buffer.from([2, 2, 2]))
    writeFileSync(first, Buffer.from([1, 1, 1]))
    h.meetings.replaceRecordingParts('meeting-1', [
      { partIndex: 0, relativePath: basename(first), byteCount: 3, durationMs: 6_000 },
      { partIndex: 1, relativePath: basename(second), byteCount: 3, durationMs: 12_000 },
    ])
    const requests: Array<{ filePath: string; recordingDurationSeconds?: number }> = []
    const gateway = {
      async transcribe(request: (typeof requests)[number]) {
        requests.push(request)
        return requests.length === 1
          ? { durationSeconds: 5, segments: [{ speakerLabel: 'A', startSeconds: 0, endSeconds: 2, text: 'Hello' }] }
          : { durationSeconds: 7, segments: [{ speakerLabel: 'A', startSeconds: 1, endSeconds: 3, text: 'Again' }] }
      },
    }

    const resolveProvider = vi.fn(() => gateway)
    const result = await new TranscriptionService(h.meetings, resolveProvider, h.recordingsDirectory).transcribeMeeting('meeting-1')
    const meetingPrefix = createHash('sha256').update('meeting-1').digest('hex')

    expect(requests.map(({ filePath }) => filePath)).toEqual([await realpath(first), await realpath(second)])
    expect(resolveProvider).toHaveBeenCalledTimes(1)
    expect(requests).toEqual([
      { filePath: await realpath(first), recordingDurationSeconds: 6 },
      { filePath: await realpath(second), recordingDurationSeconds: 6 },
    ])
    expect(result.speakers).toEqual([
      { id: `${meetingPrefix}:0:A`, meetingId: 'meeting-1', displayName: 'Speaker A' },
      { id: `${meetingPrefix}:1:A`, meetingId: 'meeting-1', displayName: 'Speaker A' },
    ])
    expect(result.segments).toEqual([
      { id: `${meetingPrefix}:0:A:0`, meetingId: 'meeting-1', speakerId: `${meetingPrefix}:0:A`, startMs: 0, endMs: 2_000, text: 'Hello' },
      { id: `${meetingPrefix}:1:A:0`, meetingId: 'meeting-1', speakerId: `${meetingPrefix}:1:A`, startMs: 6_000, endMs: 8_000, text: 'Again' },
    ])
    expect(h.meetings.requireById('meeting-1').status).toBe('summarizing')
    expect(h.meetings.listTranscript('meeting-1')).toEqual(result.segments)
    expect(h.meetings.listSpeakers('meeting-1')).toEqual(result.speakers)
    h.database.close()
  })

  it('rejects a malformed non-monotonic response before replacing the prior transcript', async () => {
    const h = harness('completed')
    const part = completedPartPath(h.recordingsDirectory, 'meeting-1', 0)
    writeFileSync(part, Buffer.from([1]))
    h.database.prepare('INSERT INTO speakers (id, meeting_id, display_name) VALUES (?, ?, ?)').run('old', 'meeting-1', 'Old')
    h.meetings.replaceTranscript('meeting-1', [{ id: 'old:0', meetingId: 'meeting-1', speakerId: 'old', startMs: 0, endMs: 10, text: 'Keep me' }])
    const gateway = {
      async transcribe() {
        return { durationSeconds: 3, segments: [
          { speakerLabel: 'A', startSeconds: 2, endSeconds: 3, text: 'Later' },
          { speakerLabel: 'A', startSeconds: 1, endSeconds: 2, text: 'Earlier' },
        ] }
      },
    }

    await expect(new TranscriptionService(h.meetings, () => gateway, h.recordingsDirectory).transcribeMeeting('meeting-1')).rejects.toMatchObject({ code: 'TRANSCRIPTION_MALFORMED_RESPONSE' })

    expect(h.meetings.listTranscript('meeting-1')).toEqual([{ id: 'old:0', meetingId: 'meeting-1', speakerId: 'old', startMs: 0, endMs: 10, text: 'Keep me' }])
    expect(h.meetings.requireById('meeting-1').status).toBe('failed')
    h.database.close()
  })

  it('preserves audio metadata, summary, and prior transcript while recording only a redacted typed failure', async () => {
    const h = harness('completed')
    const part = completedPartPath(h.recordingsDirectory, 'meeting-1', 0)
    writeFileSync(part, Buffer.from([1]))
    h.database.prepare('INSERT INTO summary_sections (id, meeting_id, kind, content_json, order_index) VALUES (?, ?, ?, ?, ?)').run('summary-1', 'meeting-1', 'paragraph', JSON.stringify({ text: 'Existing summary' }), 0)
    h.database.prepare('INSERT INTO speakers (id, meeting_id, display_name) VALUES (?, ?, ?)').run('old', 'meeting-1', 'Old')
    h.meetings.replaceTranscript('meeting-1', [{ id: 'old:0', meetingId: 'meeting-1', speakerId: 'old', startMs: 0, endMs: 10, text: 'Existing transcript' }])
    const gateway = { async transcribe() { throw safeProviderError('OPENAI_RATE_LIMITED', 'OpenAI rate limit was reached. Try again later.', true) } }

    await expect(new TranscriptionService(h.meetings, () => gateway, h.recordingsDirectory).transcribeMeeting('meeting-1')).rejects.toMatchObject({ code: 'OPENAI_RATE_LIMITED' })

    expect(h.meetings.requireById('meeting-1')).toMatchObject({ status: 'failed', audioPath: basename(completedPartPath(h.recordingsDirectory, 'meeting-1', 0)), audioByteCount: 6 })
    expect(h.meetings.listTranscript('meeting-1')[0]?.text).toBe('Existing transcript')
    expect(h.database.prepare('SELECT content_json FROM summary_sections WHERE meeting_id = ?').get('meeting-1')).toEqual({ content_json: JSON.stringify({ text: 'Existing summary' }) })
    const attempt = h.database.prepare('SELECT stage, sanitized_error FROM processing_attempts WHERE meeting_id = ? ORDER BY rowid DESC LIMIT 1').get('meeting-1') as { stage: string; sanitized_error: string }
    expect(attempt.stage).toBe('transcription')
    expect(JSON.parse(attempt.sanitized_error)).toMatchObject({ code: 'OPENAI_RATE_LIMITED' })
    expect(attempt.sanitized_error).not.toContain('sk-live-secret')
    expect(attempt.sanitized_error).not.toContain(part)
    expect(attempt.sanitized_error).not.toContain('provider canary 991')
    expect(JSON.parse(attempt.sanitized_error)).toMatchObject({
      message: 'OpenAI rate limit was reached. Try again later.',
    })
    h.database.close()
  })

  it('records distinct failed attempts when a retry fails in the same millisecond', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-14T12:00:00.000Z'))
    const h = harness()
    writeFileSync(completedPartPath(h.recordingsDirectory, 'meeting-1', 0), Buffer.from([1]))
    const service = new TranscriptionService(h.meetings, () => ({ async transcribe() { throw safeProviderError('OPENAI_RATE_LIMITED', 'OpenAI rate limit was reached. Try again later.', true) } }), h.recordingsDirectory)

    await expect(service.transcribeMeeting('meeting-1')).rejects.toMatchObject({ code: 'OPENAI_RATE_LIMITED' })
    await expect(service.transcribeMeeting('meeting-1')).rejects.toMatchObject({ code: 'OPENAI_RATE_LIMITED' })

    expect((h.database.prepare('SELECT count(*) AS count FROM processing_attempts WHERE meeting_id = ?').get('meeting-1') as { count: number }).count).toBe(2)
    h.database.close()
  })

  it('redacts the recordings directory when part discovery itself fails', async () => {
    const h = harness()
    rmSync(h.recordingsDirectory, { recursive: true })

    await expect(new TranscriptionService(h.meetings, () => ({ async transcribe() { throw new Error('unreachable') } }), h.recordingsDirectory).transcribeMeeting('meeting-1')).rejects.toMatchObject({ code: 'TRANSCRIPTION_PROVIDER_UNKNOWN' })

    const { sanitized_error: sanitizedError } = h.database.prepare('SELECT sanitized_error FROM processing_attempts WHERE meeting_id = ?').get('meeting-1') as { sanitized_error: string }
    expect(sanitizedError).not.toContain(h.recordingsDirectory)
    expect(JSON.parse(sanitizedError)).toMatchObject({ message: 'Transcription provider failed.' })
    h.database.close()
  })

  it('uses globally unique stable IDs across meetings in one database', async () => {
    const h = harness()
    h.meetings.create({
      ...h.meetings.requireById('meeting-1'),
      id: 'meeting-2',
      title: 'Second meeting',
      status: 'recorded',
    })
    writeFileSync(completedPartPath(h.recordingsDirectory, 'meeting-1', 0), Buffer.from([1]))
    writeFileSync(completedPartPath(h.recordingsDirectory, 'meeting-2', 0), Buffer.from([2]))
    const gateway = {
      async transcribe() {
        return {
          durationSeconds: 1,
          segments: [{ speakerLabel: 'A', startSeconds: 0, endSeconds: 1, text: 'Same provider labels' }],
        }
      },
    }
    const service = new TranscriptionService(h.meetings, () => gateway, h.recordingsDirectory)

    const first = await service.transcribeMeeting('meeting-1')
    const second = await service.transcribeMeeting('meeting-2')

    expect(first.speakers[0]?.id).not.toBe(second.speakers[0]?.id)
    expect(first.segments[0]?.id).not.toBe(second.segments[0]?.id)
    expect(h.meetings.listTranscript('meeting-1')).toEqual(first.segments)
    expect(h.meetings.listTranscript('meeting-2')).toEqual(second.segments)
    h.database.close()
  })

  it('keeps stable IDs and a user-renamed display name when the same meeting is reprocessed', async () => {
    const h = harness()
    writeFileSync(completedPartPath(h.recordingsDirectory, 'meeting-1', 0), Buffer.from([1]))
    const gateway = {
      async transcribe() {
        return {
          durationSeconds: 1,
          segments: [{ speakerLabel: 'A', startSeconds: 0, endSeconds: 1, text: 'Transcript' }],
        }
      },
    }
    const service = new TranscriptionService(h.meetings, () => gateway, h.recordingsDirectory)
    const first = await service.transcribeMeeting('meeting-1')
    h.database.prepare("UPDATE meetings SET status = 'completed' WHERE id = ?").run('meeting-1')
    h.database.prepare('UPDATE speakers SET display_name = ? WHERE id = ?').run('홍길동', first.speakers[0]?.id)

    const second = await service.transcribeMeeting('meeting-1')

    expect(second.speakers[0]?.id).toBe(first.speakers[0]?.id)
    expect(second.segments[0]?.id).toBe(first.segments[0]?.id)
    expect(h.meetings.listSpeakers('meeting-1')[0]?.displayName).toBe('홍길동')
    h.database.close()
  })

  it('rejects a symlinked recording part before invoking the gateway', async (context) => {
    const h = harness()
    const outside = join(h.root, 'outside.webm')
    const linkedPart = completedPartPath(h.recordingsDirectory, 'meeting-1', 0)
    writeFileSync(outside, Buffer.from([1]))
    try {
      symlinkSync(outside, linkedPart, 'file')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') {
        h.database.close()
        context.skip()
        return
      }
      throw error
    }
    const gateway = { transcribe: vi.fn() }

    await expect(new TranscriptionService(h.meetings, () => gateway, h.recordingsDirectory).transcribeMeeting('meeting-1')).rejects.toMatchObject({
      code: 'TRANSCRIPTION_INVALID_AUDIO',
    })
    expect(gateway.transcribe).not.toHaveBeenCalled()
    h.database.close()
  })

  it('uses a provider-neutral fallback while preserving concrete OpenAI classifications', () => {
    expect(toProviderError(new Error('local provider canary'))).toMatchObject({
      code: 'TRANSCRIPTION_PROVIDER_UNKNOWN', message: 'Transcription provider failed.', retryable: false,
    })
    expect(toProviderError(safeProviderError('OPENAI_UNAUTHORIZED', 'OpenAI rejected the API key.', false)))
      .toMatchObject({ code: 'OPENAI_UNAUTHORIZED', message: 'OpenAI rejected the API key.' })
  })

  it('stores null-speaker segments without creating a speaker and uses a deterministic segment ID', async () => {
    const h = harness()
    writeFileSync(completedPartPath(h.recordingsDirectory, 'meeting-1', 0), Buffer.from([1]))
    const provider = {
      async transcribe() {
        return {
          durationSeconds: 1,
          segments: [{ speakerLabel: null, startSeconds: 0, endSeconds: 1, text: 'Unattributed' }],
        }
      },
    }

    const result = await new TranscriptionService(
      h.meetings,
      () => provider,
      h.recordingsDirectory,
    ).transcribeMeeting('meeting-1')
    const meetingPrefix = createHash('sha256').update('meeting-1').digest('hex')

    expect(result.speakers).toEqual([])
    expect(result.segments).toEqual([{
      id: `${meetingPrefix}:0:segment:0`,
      meetingId: 'meeting-1',
      speakerId: null,
      startMs: 0,
      endMs: 1_000,
      text: 'Unattributed',
    }])
    h.database.close()
  })

  it('offsets local null-speaker parts by durable full-part durations including trailing silence', async () => {
    const h = harness()
    const first = completedPartPath(h.recordingsDirectory, 'meeting-1', 0)
    const second = completedPartPath(h.recordingsDirectory, 'meeting-1', 1)
    writeFileSync(first, Buffer.from([1]))
    writeFileSync(second, Buffer.from([2]))
    h.meetings.replaceRecordingParts('meeting-1', [
      { partIndex: 0, relativePath: basename(first), byteCount: 1, durationMs: 4_000 },
      { partIndex: 1, relativePath: basename(second), byteCount: 1, durationMs: 10_000 },
    ])
    const provider = {
      async transcribe(request: { filePath: string; recordingDurationSeconds?: number }) {
        return {
          durationSeconds: request.recordingDurationSeconds!,
          segments: [{ speakerLabel: null, startSeconds: 0, endSeconds: 1, text: basename(request.filePath) }],
        }
      },
    }

    const result = await new TranscriptionService(
      h.meetings, () => provider, h.recordingsDirectory,
    ).transcribeMeeting('meeting-1')

    expect(result.segments.map(({ startMs, endMs }) => ({ startMs, endMs }))).toEqual([
      { startMs: 0, endMs: 1_000 },
      { startMs: 4_000, endMs: 5_000 },
    ])
    h.database.close()
  })
})
