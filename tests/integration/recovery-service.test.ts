import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { strFromU8, unzipSync } from 'fflate'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db/database'
import { MeetingRepository } from '../../src/main/db/meetingRepository'
import { registerRecordingHandlers } from '../../src/main/ipc/registerRecordingHandlers'
import { completedPartPath, manifestPath, pendingPartPath } from '../../src/main/recording/recordingPaths'
import { RecordingService } from '../../src/main/recording/recordingService'
import { RecoveryService } from '../../src/main/recording/recoveryService'
import { writeSessionManifest } from '../../src/main/recording/sessionManifest'
import type { Meeting } from '../../src/shared/contracts/meeting'

const roots: string[] = []

function meeting(id: string, status: Meeting['status']): Meeting {
  return {
    id,
    title: id,
    createdAt: '2026-07-14T12:00:00.000Z',
    updatedAt: '2026-07-14T12:00:00.000Z',
    durationMs: status === 'recorded' ? 2_000 : 0,
    status,
    audioPolicy: 'keep',
    audioPath: status === 'recorded' ? 'normal.webm' : null,
    audioByteCount: status === 'recorded' ? 3 : 0,
    selectedTemplateId: null,
  }
}

function harness() {
  const root = mkdtempSync(join(tmpdir(), 'nnote-recovery-'))
  roots.push(root)
  const recordings = join(root, 'recordings')
  mkdirSync(recordings, { recursive: true })
  const database = openDatabase(join(root, 'nnote.sqlite'))
  const meetings = new MeetingRepository(database)
  const recording = new RecordingService(meetings, recordings)
  return { root, recordings, database, meetings, recording, recovery: new RecoveryService(meetings, recording, recordings) }
}

async function interrupted(h: ReturnType<typeof harness>, id = 'interrupted') {
  h.meetings.create(meeting(id, 'recording'))
  writeFileSync(pendingPartPath(h.recordings, id, 0), Buffer.from([1, 2, 3]))
  await writeSessionManifest(h.recordings, {
    version: 1, meetingId: id, activePartIndex: 0, totalBytes: 3, durationMs: 2_000,
    parts: [{ partIndex: 0, lastChunkIndex: 0, byteCount: 3, durationMs: 2_000, completed: false }],
  })
  h.meetings.updateRecordingProgress(id, 3, 2_000)
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('RecoveryService', () => {
  it('marks an interrupted recording recoverable and continues from its persisted cursor', async () => {
    const h = harness()
    await interrupted(h)

    const items = await h.recovery.scan()
    expect(items).toEqual([expect.objectContaining({ meetingId: 'interrupted', kind: 'recoverable', durationMs: 2_000, byteCount: 3 })])
    expect(h.meetings.requireById('interrupted').status).toBe('recoverable')

    const progress = await h.recovery.recover('interrupted')
    expect(progress).toMatchObject({ activePartIndex: 1, nextChunkIndex: 0, totalBytes: 3, rolledToPartIndex: 1 })
    expect(readFileSync(completedPartPath(h.recordings, 'interrupted', 0))).toEqual(Buffer.from([1, 2, 3]))
    expect(h.meetings.requireById('interrupted').status).toBe('recording')
    await h.recording.close()
    h.database.close()
  })

  it('returns an attached recovery to recoverable when renderer microphone attachment fails', async () => {
    const h = harness()
    await interrupted(h, 'retryable')
    await h.recovery.scan()
    await h.recovery.recover('retryable')

    await h.recovery.suspend('retryable')

    expect(h.meetings.requireById('retryable').status).toBe('recoverable')
    expect(await h.recovery.scan()).toEqual([expect.objectContaining({ meetingId: 'retryable', kind: 'recoverable' })])
    await h.recording.close()
    h.database.close()
  })

  it('leaves a normal recorded meeting and its audio unchanged', async () => {
    const h = harness()
    h.meetings.create(meeting('normal', 'recorded'))
    writeFileSync(join(h.recordings, 'normal.webm'), Buffer.from([7, 8, 9]))

    expect(await h.recovery.scan()).toEqual([])
    expect(h.meetings.requireById('normal')).toMatchObject({ status: 'recorded', audioPath: 'normal.webm', audioByteCount: 3 })
    expect(readFileSync(join(h.recordings, 'normal.webm'))).toEqual(Buffer.from([7, 8, 9]))
    h.database.close()
  })

  it('does not let renderer recovery actions target an unscanned active recording', async () => {
    const h = harness()
    h.meetings.create(meeting('active', 'recording'))

    await expect(h.recovery.recover('active')).rejects.toThrow(/startup recovery/i)
    await expect(h.recovery.discard('active', { explicitDelete: true })).rejects.toThrow(/startup recovery/i)
    expect(h.meetings.requireById('active').status).toBe('recording')
    h.database.close()
  })

  it('keeps recoverable bytes as a finalized recording idempotently', async () => {
    const h = harness()
    await interrupted(h)
    await h.recovery.scan()

    await h.recovery.keepAsFile('interrupted')
    await h.recovery.keepAsFile('interrupted')

    const completed = completedPartPath(h.recordings, 'interrupted', 0)
    expect(readFileSync(completed)).toEqual(Buffer.from([1, 2, 3]))
    expect(h.meetings.requireById('interrupted')).toMatchObject({ status: 'recorded', audioPath: basename(completed), audioByteCount: 3 })
    await expect(stat(manifestPath(h.recordings, 'interrupted'))).rejects.toMatchObject({ code: 'ENOENT' })
    h.database.close()
  })

  it('offers only finalization for a stop crash after every part was finalized', async () => {
    const h = harness()
    h.meetings.create(meeting('stop-crash', 'recording'))
    const completed = completedPartPath(h.recordings, 'stop-crash', 0)
    writeFileSync(completed, Buffer.from([2, 4, 6]))
    writeFileSync(manifestPath(h.recordings, 'stop-crash'), JSON.stringify({
      version: 1,
      meetingId: 'stop-crash',
      activePartIndex: 0,
      totalBytes: 3,
      durationMs: 2_000,
      finalized: true,
      parts: [{ partIndex: 0, lastChunkIndex: 0, byteCount: 3, durationMs: 2_000, completed: true }],
    }))
    h.meetings.updateRecordingProgress('stop-crash', 3, 2_000)

    expect(await h.recovery.scan()).toEqual([
      expect.objectContaining({ meetingId: 'stop-crash', kind: 'finalizeOnly' }),
    ])
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    registerRecordingHandlers(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      h.recording,
    )
    await expect(
      Promise.resolve().then(() => handlers.get('recording:start')!({}, 'stop-crash')),
    ).rejects.toThrow(/finalized.*recovery decision/i)
    expect(readFileSync(completed)).toEqual(Buffer.from([2, 4, 6]))
    await expect(h.recovery.recover('stop-crash')).rejects.toThrow(/cannot be resumed/i)
    await h.recovery.keepAsFile('stop-crash')

    expect(h.meetings.requireById('stop-crash').status).toBe('recorded')
    expect(readFileSync(completed)).toEqual(Buffer.from([2, 4, 6]))
    await expect(stat(pendingPartPath(h.recordings, 'stop-crash', 0))).rejects.toMatchObject({ code: 'ENOENT' })
    h.database.close()
  })

  it('classifies a legacy all-completed last-index cursor as finalization-only', async () => {
    const h = harness()
    h.meetings.create(meeting('legacy-stop', 'recording'))
    const completed = completedPartPath(h.recordings, 'legacy-stop', 0)
    writeFileSync(completed, Buffer.from([3, 3]))
    writeFileSync(manifestPath(h.recordings, 'legacy-stop'), JSON.stringify({
      version: 1, meetingId: 'legacy-stop', activePartIndex: 0, totalBytes: 2, durationMs: 1_000,
      parts: [{ partIndex: 0, lastChunkIndex: 0, byteCount: 2, durationMs: 1_000, completed: true }],
    }))

    expect(await h.recovery.scan()).toEqual([
      expect.objectContaining({ meetingId: 'legacy-stop', kind: 'finalizeOnly', byteCount: 2 }),
    ])
    await expect(h.recording.start('legacy-stop')).rejects.toThrow(/finalized.*recovery decision/i)
    expect(readFileSync(completed)).toEqual(Buffer.from([3, 3]))
    h.database.close()
  })

  it('keeps a legacy all-completed next-index rollover cursor resumable', async () => {
    const h = harness()
    h.meetings.create(meeting('legacy-rollover', 'recording'))
    writeFileSync(completedPartPath(h.recordings, 'legacy-rollover', 0), Buffer.from([5, 5]))
    writeFileSync(manifestPath(h.recordings, 'legacy-rollover'), JSON.stringify({
      version: 1, meetingId: 'legacy-rollover', activePartIndex: 1, totalBytes: 2, durationMs: 1_000,
      parts: [{ partIndex: 0, lastChunkIndex: 0, byteCount: 2, durationMs: 1_000, completed: true }],
    }))

    expect(await h.recovery.scan()).toEqual([
      expect.objectContaining({ meetingId: 'legacy-rollover', kind: 'recoverable', byteCount: 2 }),
    ])
    expect(await h.recovery.recover('legacy-rollover')).toMatchObject({ activePartIndex: 1, nextChunkIndex: 0 })
    await h.recording.close()
    h.database.close()
  })

  it('keeps a completed rollover boundary resumable when stop finalization never began', async () => {
    const h = harness()
    h.meetings.create(meeting('rollover-crash', 'recording'))
    writeFileSync(completedPartPath(h.recordings, 'rollover-crash', 0), Buffer.from([8, 9]))
    writeFileSync(manifestPath(h.recordings, 'rollover-crash'), JSON.stringify({
      version: 1, meetingId: 'rollover-crash', activePartIndex: 1, totalBytes: 2,
      durationMs: 1_000, finalized: false,
      parts: [{ partIndex: 0, lastChunkIndex: 0, byteCount: 2, durationMs: 1_000, completed: true }],
    }))

    expect(await h.recovery.scan()).toEqual([
      expect.objectContaining({ meetingId: 'rollover-crash', kind: 'recoverable' }),
    ])
    expect(await h.recovery.recover('rollover-crash')).toMatchObject({ activePartIndex: 1, nextChunkIndex: 0 })
    await h.recording.close()
    h.database.close()
  })

  it('consumes only the successful recovery decision and leaves unresolved items actionable', async () => {
    const h = harness()
    await interrupted(h, 'first')
    await interrupted(h, 'second')
    await h.recovery.scan()

    await h.recovery.recover('first')
    await expect(h.recovery.keepAsFile('first')).rejects.toThrow(/startup recovery/i)
    await expect(h.recovery.discard('first', { explicitDelete: true })).rejects.toThrow(/startup recovery/i)
    expect((await h.recovery.scan()).map(({ meetingId }) => meetingId)).toEqual(['second'])

    await h.recovery.keepAsFile('second')
    expect(h.meetings.requireById('second').status).toBe('recorded')
    await h.recording.close()
    h.database.close()
  })

  it('requires explicit deletion and makes confirmed discard retry-safe', async () => {
    const h = harness()
    await interrupted(h)
    await h.recovery.scan()

    await expect(h.recovery.discard('interrupted', { explicitDelete: false })).rejects.toThrow(/explicit/i)
    expect(readFileSync(pendingPartPath(h.recordings, 'interrupted', 0))).toEqual(Buffer.from([1, 2, 3]))
    await h.recovery.discard('interrupted', { explicitDelete: true })
    await h.recovery.discard('interrupted', { explicitDelete: true })
    expect(h.meetings.requireById('interrupted').status).toBe('deleted')
    await expect(stat(pendingPartPath(h.recordings, 'interrupted', 0))).rejects.toMatchObject({ code: 'ENOENT' })
    h.database.close()
  })

  it('preserves corrupt-manifest bytes and exposes exportOnly', async () => {
    const h = harness()
    h.meetings.create(meeting('corrupt', 'recording'))
    const pending = pendingPartPath(h.recordings, 'corrupt', 0)
    writeFileSync(pending, Buffer.from([4, 5, 6, 7]))
    writeFileSync(manifestPath(h.recordings, 'corrupt'), '{ definitely not json')

    const items = await h.recovery.scan()

    expect(items).toEqual([expect.objectContaining({ meetingId: 'corrupt', kind: 'exportOnly', byteCount: 4 })])
    expect(readFileSync(pending)).toEqual(Buffer.from([4, 5, 6, 7]))
    await expect(h.recovery.recover('corrupt')).rejects.toThrow(/cannot be resumed/i)
    const exported = join(h.root, 'recovered.webm')
    await h.recovery.exportOnly('corrupt', exported)
    expect(readFileSync(exported)).toEqual(Buffer.from([4, 5, 6, 7]))
    expect(readFileSync(pending)).toEqual(Buffer.from([4, 5, 6, 7]))
    h.database.close()
  })

  it('packages independent multi-part export-only WebMs without concatenating them', async () => {
    const h = harness()
    h.meetings.create(meeting('corrupt-multi', 'recording'))
    const first = Buffer.from([1, 2, 3])
    const second = Buffer.from([9, 8])
    writeFileSync(completedPartPath(h.recordings, 'corrupt-multi', 0), first)
    writeFileSync(pendingPartPath(h.recordings, 'corrupt-multi', 1), second)
    writeFileSync(manifestPath(h.recordings, 'corrupt-multi'), '{ invalid')
    await h.recovery.scan()

    expect(await h.recovery.exportOnlyFormat('corrupt-multi')).toEqual({ partCount: 2, extension: 'zip' })
    const destination = join(h.root, 'recovered.zip')
    await h.recovery.exportOnly('corrupt-multi', destination)
    const files = unzipSync(readFileSync(destination))
    const manifest = JSON.parse(strFromU8(files['manifest.json']!))
    expect(manifest).toEqual({
      format: 'nnote-recovery', version: 1,
      parts: [
        { partIndex: 0, entry: 'audio/part-0.webm', byteCount: 3 },
        { partIndex: 1, entry: 'audio/part-1.webm', byteCount: 2 },
      ],
    })
    expect(files['audio/part-0.webm']).toEqual(new Uint8Array(first))
    expect(files['audio/part-1.webm']).toEqual(new Uint8Array(second))
    h.database.close()
  })

  it('does not export preserved bytes until scan authorizes an export-only recovery item', async () => {
    const h = harness()
    h.meetings.create(meeting('unscanned', 'recording'))
    writeFileSync(pendingPartPath(h.recordings, 'unscanned', 0), Buffer.from([9]))

    await expect(h.recovery.exportOnly('unscanned', join(h.root, 'no.webm'))).rejects.toThrow(/startup recovery/i)
    expect(() => readFileSync(join(h.root, 'no.webm'))).toThrow()
    h.database.close()
  })

  it.each([
    ['active part outside the cursor', { activePartIndex: 99 }],
    ['non-contiguous part indices', { parts: [
      { partIndex: 0, lastChunkIndex: 0, byteCount: 2, durationMs: 1_000, completed: true },
      { partIndex: 2, lastChunkIndex: 0, byteCount: 2, durationMs: 2_000, completed: false },
    ], activePartIndex: 2, totalBytes: 4 }],
    ['completed part after active part', { parts: [
      { partIndex: 0, lastChunkIndex: 0, byteCount: 2, durationMs: 1_000, completed: false },
      { partIndex: 1, lastChunkIndex: 0, byteCount: 2, durationMs: 2_000, completed: true },
    ], activePartIndex: 0, totalBytes: 4 }],
    ['incoherent aggregate bytes', { totalBytes: 99 }],
    ['invalid finalization marker', { finalized: 'yes' }],
  ])('preserves bytes as exportOnly for %s', async (_name, overrides) => {
    const h = harness()
    const id = `topology-${roots.length}`
    h.meetings.create(meeting(id, 'recording'))
    writeFileSync(pendingPartPath(h.recordings, id, 0), Buffer.from([1, 2]))
    writeFileSync(completedPartPath(h.recordings, id, 1), Buffer.from([3, 4]))
    const base = {
      version: 1, meetingId: id, activePartIndex: 1, totalBytes: 4, durationMs: 2_000,
      parts: [
        { partIndex: 0, lastChunkIndex: 0, byteCount: 2, durationMs: 1_000, completed: true },
        { partIndex: 1, lastChunkIndex: 0, byteCount: 2, durationMs: 2_000, completed: false },
      ],
    }
    writeFileSync(manifestPath(h.recordings, id), JSON.stringify({ ...base, ...overrides }))

    const [item] = await h.recovery.scan()
    expect(item).toMatchObject({ meetingId: id, kind: 'exportOnly', byteCount: 4 })
    expect(readFileSync(pendingPartPath(h.recordings, id, 0))).toEqual(Buffer.from([1, 2]))
    expect(readFileSync(completedPartPath(h.recordings, id, 1))).toEqual(Buffer.from([3, 4]))
    h.database.close()
  })
})
