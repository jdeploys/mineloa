import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../../src/main/db/database'
import { MeetingRepository } from '../../src/main/db/meetingRepository'
import type { CredentialStore } from '../../src/main/credentials/credentialStore'
import { OpenAiGateway, type OpenAiTranscriptionClient } from '../../src/main/ai/openAiGateway'
import { OpenAiError, toOpenAiError } from '../../src/main/ai/openAiErrors'
import { TranscriptionService } from '../../src/main/ai/transcriptionService'
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
    const service = new TranscriptionService(h.meetings, gateway, h.recordingsDirectory)
    await expect(service.transcribeMeeting('meeting-1')).rejects.toMatchObject({ code: 'OPENAI_UNKNOWN' })
    expect(gateway.transcribe).not.toHaveBeenCalled()
    expect(h.meetings.latestProcessingAttempt('meeting-1')).toMatchObject({ succeeded: false, finishedAt: expect.any(String) })
    begin.mockRestore()
    await expect(service.transcribeMeeting('meeting-1')).resolves.toBeDefined()
    h.database.close()
  })
  it('transcribes finalized parts in order and normalizes stable part-scoped speakers', async () => {
    const h = harness()
    const second = completedPartPath(h.recordingsDirectory, 'meeting-1', 1)
    const first = completedPartPath(h.recordingsDirectory, 'meeting-1', 0)
    writeFileSync(second, Buffer.from([2, 2, 2]))
    writeFileSync(first, Buffer.from([1, 1, 1]))
    h.meetings.replaceRecordingParts('meeting-1', [
      { partIndex: 0, relativePath: basename(first), byteCount: 3, durationMs: 6_000 },
      { partIndex: 1, relativePath: basename(second), byteCount: 3, durationMs: 12_000 },
    ])
    const requests: Array<{ filePath: string; model: string; responseFormat: string; chunkingStrategy: string }> = []
    const gateway = {
      async transcribe(request: (typeof requests)[number]) {
        requests.push(request)
        return requests.length === 1
          ? { durationSeconds: 5, segments: [{ speaker: 'A', startSeconds: 0, endSeconds: 2, text: 'Hello' }] }
          : { durationSeconds: 7, segments: [{ speaker: 'A', startSeconds: 1, endSeconds: 3, text: 'Again' }] }
      },
    }

    const result = await new TranscriptionService(h.meetings, gateway, h.recordingsDirectory).transcribeMeeting('meeting-1')
    const meetingPrefix = createHash('sha256').update('meeting-1').digest('hex')

    expect(requests.map(({ filePath }) => filePath)).toEqual([first, second])
    expect(requests[0]).toMatchObject({
      model: 'gpt-4o-transcribe-diarize',
      responseFormat: 'diarized_json',
      chunkingStrategy: 'auto',
    })
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
          { speaker: 'A', startSeconds: 2, endSeconds: 3, text: 'Later' },
          { speaker: 'A', startSeconds: 1, endSeconds: 2, text: 'Earlier' },
        ] }
      },
    }

    await expect(new TranscriptionService(h.meetings, gateway, h.recordingsDirectory).transcribeMeeting('meeting-1')).rejects.toMatchObject({ code: 'OPENAI_MALFORMED_RESPONSE' })

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
    const gateway = { async transcribe() { throw Object.assign(new Error(`provider canary 991 Authorization: Bearer sk-live-secret failed at ${part}`), { status: 429 }) } }

    await expect(new TranscriptionService(h.meetings, gateway, h.recordingsDirectory).transcribeMeeting('meeting-1')).rejects.toMatchObject({ code: 'OPENAI_RATE_LIMITED' })

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
    const service = new TranscriptionService(h.meetings, { async transcribe() { throw Object.assign(new Error('busy'), { status: 429 }) } }, h.recordingsDirectory)

    await expect(service.transcribeMeeting('meeting-1')).rejects.toMatchObject({ code: 'OPENAI_RATE_LIMITED' })
    await expect(service.transcribeMeeting('meeting-1')).rejects.toMatchObject({ code: 'OPENAI_RATE_LIMITED' })

    expect((h.database.prepare('SELECT count(*) AS count FROM processing_attempts WHERE meeting_id = ?').get('meeting-1') as { count: number }).count).toBe(2)
    h.database.close()
  })

  it('redacts the recordings directory when part discovery itself fails', async () => {
    const h = harness()
    rmSync(h.recordingsDirectory, { recursive: true })

    await expect(new TranscriptionService(h.meetings, { async transcribe() { throw new Error('unreachable') } }, h.recordingsDirectory).transcribeMeeting('meeting-1')).rejects.toMatchObject({ code: 'OPENAI_UNKNOWN' })

    const { sanitized_error: sanitizedError } = h.database.prepare('SELECT sanitized_error FROM processing_attempts WHERE meeting_id = ?').get('meeting-1') as { sanitized_error: string }
    expect(sanitizedError).not.toContain(h.recordingsDirectory)
    expect(JSON.parse(sanitizedError)).toMatchObject({ message: 'OpenAI transcription failed.' })
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
          segments: [{ speaker: 'A', startSeconds: 0, endSeconds: 1, text: 'Same provider labels' }],
        }
      },
    }
    const service = new TranscriptionService(h.meetings, gateway, h.recordingsDirectory)

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
          segments: [{ speaker: 'A', startSeconds: 0, endSeconds: 1, text: 'Transcript' }],
        }
      },
    }
    const service = new TranscriptionService(h.meetings, gateway, h.recordingsDirectory)
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

    await expect(new TranscriptionService(h.meetings, gateway, h.recordingsDirectory).transcribeMeeting('meeting-1')).rejects.toMatchObject({
      code: 'OPENAI_INVALID_AUDIO',
    })
    expect(gateway.transcribe).not.toHaveBeenCalled()
    h.database.close()
  })
})
