import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProcessingService } from '../../src/main/ai/processingService'
import { TranscriptionService } from '../../src/main/ai/transcriptionService'
import { PROCESS_OWNER_ID } from '../../src/main/ai/processingOwner'
import { openDatabase } from '../../src/main/db/database'
import { MeetingRepository } from '../../src/main/db/meetingRepository'
import { completedPartPath } from '../../src/main/recording/recordingPaths'
import type { AudioPolicy, MeetingStatus } from '../../src/shared/contracts/meeting'

const roots: string[] = []

function harness(options: { policy?: AudioPolicy; status?: MeetingStatus; failSummary?: boolean; failCleanup?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nnote-processing-'))
  roots.push(root)
  const recordings = join(root, 'recordings')
  mkdirSync(recordings)
  const database = openDatabase(join(root, 'nnote.sqlite'))
  const meetings = new MeetingRepository(database)
  const now = '2026-07-15T00:00:00.000Z'
  const first = completedPartPath(recordings, 'meeting-1', 0)
  const second = completedPartPath(recordings, 'meeting-1', 1)
  meetings.create({
    id: 'meeting-1', title: 'Meeting', createdAt: now, updatedAt: now, durationMs: 1_000,
    status: options.status ?? 'recorded', audioPolicy: options.policy ?? 'delete_after_processing',
    audioPath: basename(first), audioByteCount: 6, selectedTemplateId: null,
  })
  writeFileSync(first, 'abc')
  writeFileSync(second, 'def')
  meetings.replaceRecordingParts('meeting-1', [
    { partIndex: 0, relativePath: basename(first), byteCount: 3, durationMs: 500 },
    { partIndex: 1, relativePath: basename(second), byteCount: 3, durationMs: 1_000 },
  ])
  const transcribe = vi.fn(async () => {
    return meetings.completeTranscription(
      'meeting-1',
      [{ id: 'speaker-1', meetingId: 'meeting-1', displayName: 'Speaker 1' }],
      [{ id: 'segment-1', meetingId: 'meeting-1', speakerId: 'speaker-1', startMs: 0, endMs: 1000, text: 'hello' }],
    )
  })
  const summarize = vi.fn(async () => {
    if (options.failSummary) throw Object.assign(new Error('safe summary failure'), { code: 'OPENAI_NETWORK', retryable: true })
    return meetings.completeSummary('meeting-1', [], [])
  })
  let cleanupFailures = options.failCleanup ? 1 : 0
  const service = new ProcessingService(meetings, { transcribeMeeting: transcribe }, { summarizeMeeting: summarize }, recordings, {
    remove: async (path) => {
      if (cleanupFailures-- > 0) throw Object.assign(new Error('locked'), { code: 'EBUSY' })
      rmSync(path, { force: true })
    },
  })
  return { database, meetings, service, transcribe, summarize, first, second }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('ProcessingService', () => {
  it('deletes every finalized audio part only after transcript and summary commit', async () => {
    const h = harness()
    await h.service.process('meeting-1')
    expect(h.meetings.requireById('meeting-1')).toMatchObject({ status: 'completed', audioPath: null, audioByteCount: 0 })
    expect(existsSync(h.first)).toBe(false)
    expect(existsSync(h.second)).toBe(false)
    h.database.close()
  })

  it('keeps every audio part after success when policy is keep', async () => {
    const h = harness({ policy: 'keep' })
    await h.service.process('meeting-1')
    expect(h.meetings.requireById('meeting-1')).toMatchObject({ status: 'completed', audioByteCount: 6 })
    expect(existsSync(h.first)).toBe(true)
    expect(existsSync(h.second)).toBe(true)
    h.database.close()
  })

  it('retains committed transcript and audio on summary failure then retries summary without transcription', async () => {
    const h = harness({ failSummary: true })
    await expect(h.service.process('meeting-1')).rejects.toThrow('safe summary failure')
    expect(h.meetings.requireById('meeting-1').status).toBe('failed')
    expect(h.meetings.listTranscript('meeting-1')).toHaveLength(1)
    expect(existsSync(h.first)).toBe(true)
    h.summarize.mockImplementationOnce(async () => h.meetings.completeSummary('meeting-1', [], []))
    await h.service.retry('meeting-1')
    expect(h.transcribe).toHaveBeenCalledTimes(1)
    expect(h.summarize).toHaveBeenCalledTimes(2)
    h.database.close()
  })

  it('rolls back a summary persistence failure and retries only summarization', async () => {
    const h = harness()
    h.summarize.mockImplementationOnce(async () => h.meetings.completeSummary('meeting-1', [{
      templateSectionId: 'not-a-uuid', kind: 'paragraph', text: 'invalid', items: [], orderIndex: 0,
    }] as never, []))
    await expect(h.service.process('meeting-1')).rejects.toThrow()
    expect(h.meetings.listTranscript('meeting-1')).toHaveLength(1)
    expect(h.meetings.listSummarySections('meeting-1')).toHaveLength(0)
    expect(existsSync(h.first)).toBe(true)
    await h.service.retry('meeting-1')
    expect(h.transcribe).toHaveBeenCalledTimes(1)
    expect(h.summarize).toHaveBeenCalledTimes(2)
    h.database.close()
  })

  it('retries transcription failures from transcription and requires audio', async () => {
    const h = harness()
    h.transcribe.mockImplementationOnce(async () => {
      throw Object.assign(new Error('network'), { code: 'OPENAI_NETWORK', retryable: true })
    })
    await expect(h.service.process('meeting-1')).rejects.toThrow('network')
    expect(h.service.getStatus('meeting-1')).toMatchObject({ state: 'failed', failedStage: 'transcribing', audioRequired: true })
    await h.service.retry('meeting-1')
    expect(h.transcribe).toHaveBeenCalledTimes(2)
    h.database.close()
  })

  it('keeps the orchestration attempt authoritative when transcription records its failure', async () => {
    const h = harness()
    h.transcribe.mockImplementationOnce(async () => {
      h.meetings.failTranscription('meeting-1', { code: 'OPENAI_NETWORK', message: 'safe', retryable: true })
      throw Object.assign(new Error('safe'), { code: 'OPENAI_NETWORK', retryable: true })
    })
    await expect(h.service.process('meeting-1')).rejects.toThrow('safe')
    expect(h.service.getStatus('meeting-1')).toMatchObject({ failedStage: 'transcribing', retryable: true })
    expect(h.meetings.latestProcessingAttempt('meeting-1')?.stage).toBe('transcribing')
    h.database.close()
  })

  it('recovers idempotently from cleanup failure without rerunning AI', async () => {
    const h = harness({ failCleanup: true })
    await h.service.process('meeting-1')
    expect(h.service.getStatus('meeting-1')).toMatchObject({ state: 'cleanup_failed', failedStage: 'cleanup', audioRequired: false })
    expect(h.meetings.requireById('meeting-1').status).toBe('completed')
    await h.service.retry('meeting-1')
    expect(h.transcribe).toHaveBeenCalledTimes(1)
    expect(h.summarize).toHaveBeenCalledTimes(1)
    expect(h.meetings.requireById('meeting-1')).toMatchObject({ audioPath: null, audioByteCount: 0 })
    h.database.close()
  })

  it('deletes non-primary parts first and preserves coherent primary metadata when primary deletion fails', async () => {
    const h = harness({ policy: 'delete_after_processing' })
    const removes: string[] = []
    const service = new ProcessingService(h.meetings, { transcribeMeeting: h.transcribe }, { summarizeMeeting: h.summarize }, join(h.first, '..'), {
      remove: async (path) => {
        removes.push(path)
        if (path === h.first) throw Object.assign(new Error('locked primary'), { code: 'EBUSY' })
        rmSync(path, { force: true })
      },
    })
    await service.process('meeting-1')
    expect(removes).toEqual([h.second, h.first])
    expect(existsSync(h.second)).toBe(false)
    expect(existsSync(h.first)).toBe(true)
    expect(h.meetings.requireById('meeting-1')).toMatchObject({ audioPath: basename(h.first), audioByteCount: 3, status: 'completed' })
    await h.service.retry('meeting-1')
    expect(h.meetings.requireById('meeting-1')).toMatchObject({ audioPath: null, audioByteCount: 0 })
    h.database.close()
  })

  it.each([
    ['transcribing', true],
    ['summarizing', false],
  ] as const)('reconciles an unfinished %s attempt after database reopen without calling AI', async (stage, audioRequired) => {
    const h = harness({ policy: 'keep' })
    h.meetings.beginProcessingAttempt('meeting-1', stage, 'old-process')
    stage === 'transcribing' ? h.meetings.beginTranscription('meeting-1') : h.database.prepare("UPDATE meetings SET status = 'summarizing' WHERE id = ?").run('meeting-1')
    const databasePath = h.database.name
    h.database.close()
    const reopened = openDatabase(databasePath)
    const meetings = new MeetingRepository(reopened)
    const transcribe = vi.fn()
    const summarize = vi.fn()
    const service = new ProcessingService(meetings, { transcribeMeeting: transcribe }, { summarizeMeeting: summarize }, join(h.first, '..'), undefined, 'new-process')
    expect(service.getStatus('meeting-1')).toMatchObject({
      state: 'failed', failedStage: stage, retryable: true, audioRequired,
      error: { code: 'PROCESSING_INTERRUPTED', message: 'Processing was interrupted. Try again.' },
    })
    expect(transcribe).not.toHaveBeenCalled()
    expect(summarize).not.toHaveBeenCalled()
    reopened.close()
  })

  it('reopens after transcript commit before attempt finish and retries summary without transcription', async () => {
    const h = harness({ policy: 'keep' })
    const attempt = h.meetings.beginProcessingAttempt('meeting-1', 'transcribing', 'old-process')
    h.meetings.beginTranscription('meeting-1')
    h.meetings.completeTranscription(
      'meeting-1',
      [{ id: 'speaker-crash', meetingId: 'meeting-1', displayName: 'Speaker' }],
      [{ id: 'segment-crash', meetingId: 'meeting-1', speakerId: 'speaker-crash', startMs: 0, endMs: 1_000, text: 'committed' }],
    )
    const databasePath = h.database.name
    h.database.close()
    const reopened = openDatabase(databasePath)
    const meetings = new MeetingRepository(reopened)
    const transcribe = vi.fn()
    const summarize = vi.fn(async () => meetings.completeSummary('meeting-1', [], []))
    const service = new ProcessingService(meetings, { transcribeMeeting: transcribe }, { summarizeMeeting: summarize }, join(h.first, '..'), undefined, 'new-process')

    expect(meetings.latestProcessingAttempt('meeting-1')).toMatchObject({ stage: 'summarizing', succeeded: false })
    expect(reopened.prepare('SELECT succeeded, sanitized_error FROM processing_attempts WHERE id = ?').get(attempt.id)).toEqual({ succeeded: 1, sanitized_error: null })
    expect(service.getStatus('meeting-1')).toMatchObject({ state: 'failed', failedStage: 'summarizing', retryable: true, audioRequired: false })
    await service.retry('meeting-1')
    expect(transcribe).not.toHaveBeenCalled()
    expect(summarize).toHaveBeenCalledTimes(1)
    reopened.close()
  })

  it.each([
    ['delete_after_processing', 'cleanup_failed'],
    ['keep', 'completed'],
  ] as const)('reopens after summary commit before attempt finish with %s policy as %s without AI', async (policy, expectedState) => {
    const h = harness({ policy })
    h.database.prepare("UPDATE meetings SET status = 'summarizing' WHERE id = ?").run('meeting-1')
    const attempt = h.meetings.beginProcessingAttempt('meeting-1', 'summarizing', 'old-process')
    h.meetings.completeSummary('meeting-1', [], [])
    const databasePath = h.database.name
    h.database.close()
    const reopened = openDatabase(databasePath)
    const meetings = new MeetingRepository(reopened)
    const transcribe = vi.fn()
    const summarize = vi.fn()
    const service = new ProcessingService(meetings, { transcribeMeeting: transcribe }, { summarizeMeeting: summarize }, join(h.first, '..'), undefined, 'new-process')

    expect(reopened.prepare('SELECT succeeded, sanitized_error FROM processing_attempts WHERE id = ?').get(attempt.id)).toEqual({ succeeded: 1, sanitized_error: null })
    expect(service.getStatus('meeting-1').state).toBe(expectedState)
    if (policy === 'delete_after_processing') {
      expect(meetings.latestProcessingAttempt('meeting-1')).toMatchObject({ stage: 'cleanup', succeeded: false })
      await service.retry('meeting-1')
      expect(meetings.requireById('meeting-1')).toMatchObject({ status: 'completed', audioPath: null, audioByteCount: 0 })
    } else {
      expect(existsSync(h.first)).toBe(true)
    }
    expect(transcribe).not.toHaveBeenCalled()
    expect(summarize).not.toHaveBeenCalled()
    reopened.close()
  })

  it('reopens a completed delete-policy meeting after summary commit before cleanup attempt creation', async () => {
    const h = harness()
    h.database.prepare("UPDATE meetings SET status = 'summarizing' WHERE id = ?").run('meeting-1')
    h.meetings.completeSummary('meeting-1', [], [])
    const databasePath = h.database.name
    h.database.close()
    const reopened = openDatabase(databasePath)
    const meetings = new MeetingRepository(reopened)
    const transcribe = vi.fn()
    const summarize = vi.fn()
    const service = new ProcessingService(meetings, { transcribeMeeting: transcribe }, { summarizeMeeting: summarize }, join(h.first, '..'), undefined, 'new-process')
    expect(service.getStatus('meeting-1')).toMatchObject({ state: 'cleanup_failed', failedStage: 'cleanup', audioRequired: false })
    await service.retry('meeting-1')
    expect(transcribe).not.toHaveBeenCalled()
    expect(summarize).not.toHaveBeenCalled()
    expect(meetings.requireById('meeting-1').audioPath).toBeNull()
    reopened.close()
  })

  it('reopens after cleanup attempt creation and resumes deletion without AI', async () => {
    const h = harness()
    h.database.prepare("UPDATE meetings SET status = 'summarizing' WHERE id = ?").run('meeting-1')
    h.meetings.completeSummary('meeting-1', [], [])
    const cleanup = h.meetings.beginProcessingAttempt('meeting-1', 'cleanup', 'old-process')
    const databasePath = h.database.name
    h.database.close()
    const reopened = openDatabase(databasePath)
    const meetings = new MeetingRepository(reopened)
    const transcribe = vi.fn()
    const summarize = vi.fn()
    const service = new ProcessingService(meetings, { transcribeMeeting: transcribe }, { summarizeMeeting: summarize }, join(h.first, '..'), undefined, 'new-process')
    expect(reopened.prepare('SELECT succeeded, sanitized_error FROM processing_attempts WHERE id = ?').get(cleanup.id)).toMatchObject({ succeeded: 0, sanitized_error: expect.stringContaining('AUDIO_CLEANUP_INTERRUPTED') })
    expect(service.getStatus('meeting-1').state).toBe('cleanup_failed')
    await service.retry('meeting-1')
    expect(transcribe).not.toHaveBeenCalled()
    expect(summarize).not.toHaveBeenCalled()
    expect(meetings.requireById('meeting-1').audioPath).toBeNull()
    reopened.close()
  })

  it('preserves a legacy Task 7 nonretryable transcription failure exactly', () => {
    const h = harness()
    h.meetings.beginTranscription('meeting-1')
    h.meetings.failTranscription('meeting-1', { code: 'OPENAI_UNAUTHORIZED', message: 'OpenAI rejected the API key.', retryable: false })
    expect(h.service.getStatus('meeting-1')).toMatchObject({
      failedStage: 'transcribing', retryable: false, audioRequired: true,
      error: { code: 'OPENAI_UNAUTHORIZED', message: 'OpenAI rejected the API key.' },
    })
    h.database.close()
  })

  it('isolates throwing progress observers so completed processing is never stranded', async () => {
    const h = harness({ policy: 'keep' })
    h.service.subscribe(() => { throw new Error('observer failed') })
    await expect(h.service.process('meeting-1')).resolves.toMatchObject({ state: 'completed' })
    expect(h.meetings.requireById('meeting-1').status).toBe('completed')
    h.database.close()
  })

  it('rejects a direct transcription race before the competing gateway request', async () => {
    const h = harness({ policy: 'keep' })
    let release!: () => void
    h.transcribe.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(h.meetings.completeTranscription('meeting-1', [], [])) }))
    const first = h.service.process('meeting-1')
    const competingGateway = { transcribe: vi.fn() }
    const direct = new TranscriptionService(h.meetings, competingGateway, join(h.first, '..'))
    await expect(direct.transcribeMeeting('meeting-1')).rejects.toThrow(/already running/i)
    expect(competingGateway.transcribe).not.toHaveBeenCalled()
    release()
    await first
    h.database.close()
  })

  it('does not reconcile a persisted live direct transcription owner as stale in the same process', async () => {
    const h = harness({ policy: 'keep' })
    const attempt = h.meetings.beginProcessingAttempt('meeting-1', 'transcription', PROCESS_OWNER_ID)
    h.meetings.beginTranscription('meeting-1')
    const competingTranscribe = vi.fn()
    const competing = new ProcessingService(h.meetings, { transcribeMeeting: competingTranscribe }, { summarizeMeeting: vi.fn() }, join(h.first, '..'))
    const competingResult = await competing.process('meeting-1').catch((error: unknown) => error)
    expect(competingResult).toBeInstanceOf(Error)
    expect(String(competingResult)).toMatch(/already running|recorded meeting/i)
    expect(competingTranscribe).not.toHaveBeenCalled()
    expect(h.meetings.requireById('meeting-1').status).toBe('transcribing')
    h.meetings.failTranscription('meeting-1', { code: 'OPENAI_NETWORK', message: 'safe', retryable: true })
    h.meetings.finishProcessingAttempt(attempt.id, { succeeded: false, error: { code: 'OPENAI_NETWORK', message: 'safe', retryable: true } })
    h.database.close()
  })

  it('rejects concurrent starts for the same meeting and releases the lock after settle', async () => {
    const h = harness({ policy: 'keep' })
    let release!: () => void
    h.transcribe.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(h.meetings.completeTranscription('meeting-1', [], [])) }))
    const first = h.service.process('meeting-1')
    await expect(h.service.process('meeting-1')).rejects.toMatchObject({ code: 'PROCESSING_ALREADY_RUNNING' })
    release()
    await first
    expect(h.service.getStatus('meeting-1').state).toBe('completed')
    h.database.close()
  })
})
