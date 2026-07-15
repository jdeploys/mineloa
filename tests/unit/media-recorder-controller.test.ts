import { describe, expect, it, vi } from 'vitest'
import { MAX_RECORDING_DURATION_MS, type RecordingApi } from '../../src/shared/contracts/recording'
import {
  MediaRecorderController,
  RecordingTerminalError,
} from '../../src/renderer/src/features/recording/mediaRecorderController'

class FakeTrack {
  readonly stop = vi.fn()
}

class FakeMediaRecorder extends EventTarget {
  readonly mimeType = 'audio/webm;codecs=opus'
  readonly state: RecordingState = 'inactive'
  readonly start = vi.fn()
  readonly pause = vi.fn()
  readonly resume = vi.fn()

  stop(): void {
    this.dispatchEvent(
      new MessageEvent('dataavailable', {
        data: new Blob([Uint8Array.from([2])], { type: this.mimeType }),
      }),
    )
    this.dispatchEvent(new Event('stop'))
  }

  emit(bytes: number[]): void {
    this.dispatchEvent(
      new MessageEvent('dataavailable', { data: new Blob([Uint8Array.from(bytes)], { type: this.mimeType }) }),
    )
  }
}

function createHarness() {
  const track = new FakeTrack()
  const stream = { getTracks: () => [track] } as unknown as MediaStream
  let recorder: FakeMediaRecorder | undefined
  let clock = 0
  const calls: string[] = []
  let releaseFinalAppend!: () => void
  const finalAppendGate = new Promise<void>((resolve) => {
    releaseFinalAppend = resolve
  })
  const recording: RecordingApi = {
    start: vi.fn(async () => ({ totalBytes: 0, durationMs: 0, warn: false, rolledToPartIndex: null, activePartIndex: 0, nextChunkIndex: 0 })),
    cancelStart: vi.fn(async () => undefined),
    appendChunk: vi.fn(async (input) => {
      calls.push(`append:${input.chunkIndex}`)
      if (input.chunkIndex === 1) await finalAppendGate
      return { totalBytes: input.bytes.byteLength, durationMs: input.durationMs, warn: false, rolledToPartIndex: null, activePartIndex: 0, nextChunkIndex: input.chunkIndex + 1 }
    }),
    pause: vi.fn(async () => undefined),
    resume: vi.fn(async () => ({ totalBytes: 0, durationMs: 0, warn: false, rolledToPartIndex: null, activePartIndex: 0, nextChunkIndex: 0 })),
    stop: vi.fn(async () => {
      calls.push('stop')
    }),
    discard: vi.fn(async () => undefined),
  }
  const controller = new MediaRecorderController(recording, {
    getUserMedia: vi.fn(async () => stream),
    createRecorder: (receivedStream, options) => {
      expect(receivedStream).toBe(stream)
      expect(options).toEqual({ mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 20_000 })
      recorder = new FakeMediaRecorder()
      return recorder as unknown as MediaRecorder
    },
    now: () => clock,
  })
  return {
    controller,
    recording,
    track,
    calls,
    getRecorder: () => recorder!,
    setClock: (value: number) => {
      clock = value
    },
    releaseFinalAppend,
  }
}

describe('MediaRecorderController', () => {
  it('auto-stops successfully when Main clamps a crossing dataavailable chunk to two hours', async () => {
    const automaticStop = vi.fn()
    const harness = createHarness()
    const recorder = new FakeMediaRecorder()
    const snapshots: Array<{ phase: string }> = []
    const controller = new MediaRecorderController(harness.recording, {
      getUserMedia: vi.fn(async () => ({ getTracks: () => [harness.track] }) as unknown as MediaStream),
      createRecorder: () => recorder as unknown as MediaRecorder,
      now: () => MAX_RECORDING_DURATION_MS + 9,
    }, { onAutomaticStop: automaticStop })
    controller.subscribe((snapshot) => snapshots.push(snapshot))
    vi.mocked(harness.recording.appendChunk).mockImplementationOnce(async () => ({
        totalBytes: 3, durationMs: MAX_RECORDING_DURATION_MS, maxReached: true,
        warn: false, rollRequired: false, rolledToPartIndex: null, activePartIndex: 0, nextChunkIndex: 1,
      })).mockRejectedValue(new Error('Recording exceeds the two-hour duration limit'))

    await controller.start('meeting-1')
    recorder.emit([1, 2])

    await vi.waitFor(() => expect(harness.recording.stop).toHaveBeenCalledOnce())
    expect(harness.recording.appendChunk).toHaveBeenCalledOnce()
    expect(automaticStop).toHaveBeenCalledOnce()
    expect(harness.recording.discard).not.toHaveBeenCalled()
    expect(controller.getSnapshot()).toMatchObject({ phase: 'idle' })
    expect(snapshots).not.toContainEqual(expect.objectContaining({ phase: 'failed' }))
  })
  it('starts a fresh self-contained MediaRecorder after Main explicitly commits a full part', async () => {
    const track = new FakeTrack()
    const recorders: FakeMediaRecorder[] = []
    const appended: Array<{ partIndex: number; bytes: number[] }> = []
    let rollRequired = true
    const recording = {
      start: vi.fn(async () => ({ totalBytes: 0, durationMs: 0, warn: false, rollRequired: false, rolledToPartIndex: null, activePartIndex: 0, nextChunkIndex: 0 })),
      cancelStart: vi.fn(async () => undefined),
      appendChunk: vi.fn(async (input) => {
        appended.push({ partIndex: input.partIndex, bytes: [...input.bytes] })
        const shouldRoll = rollRequired
        rollRequired = false
        return { totalBytes: appended.reduce((sum, item) => sum + item.bytes.length, 0), durationMs: input.durationMs, warn: shouldRoll, rollRequired: shouldRoll, rolledToPartIndex: null, activePartIndex: input.partIndex, nextChunkIndex: input.chunkIndex + 1 }
      }),
      rollPart: vi.fn(async () => ({ totalBytes: 2, durationMs: 10_000, warn: false, rollRequired: false, rolledToPartIndex: 1, activePartIndex: 1, nextChunkIndex: 0 })),
      pause: vi.fn(async () => undefined), resume: vi.fn(), stop: vi.fn(async () => undefined), discard: vi.fn(async () => undefined),
    } satisfies RecordingApi
    const controller = new MediaRecorderController(recording, {
      getUserMedia: vi.fn(async () => ({ getTracks: () => [track] }) as unknown as MediaStream),
      createRecorder: () => {
        const recorder = new FakeMediaRecorder()
        recorders.push(recorder)
        return recorder as unknown as MediaRecorder
      },
      now: () => 10_000,
    })

    await controller.start('meeting-1')
    recorders[0]!.emit([0x1a, 0x45])
    await vi.waitFor(() => expect(recording.rollPart).toHaveBeenCalledWith('meeting-1', 0))
    await vi.waitFor(() => expect(recorders).toHaveLength(2))
    recorders[1]!.emit([0x1a, 0x45, 0xdf])
    await vi.waitFor(() => expect(recording.appendChunk).toHaveBeenCalledTimes(3))

    expect(recorders[0]!.start).toHaveBeenCalledWith(10_000)
    expect(recorders[1]!.start).toHaveBeenCalledWith(10_000)
    expect(appended.at(-1)).toEqual({ partIndex: 1, bytes: [0x1a, 0x45, 0xdf] })
    await controller.discard()
  })

  it('automatically stops at the exact two-hour recorded-duration boundary and publishes telemetry', async () => {
    const track = new FakeTrack()
    const recorder = new FakeMediaRecorder()
    const stopped = vi.fn()
    let clock = 0
    const recording = {
      start: vi.fn(async () => ({ totalBytes: 0, durationMs: 0, warn: false, rollRequired: false, rolledToPartIndex: null, activePartIndex: 0, nextChunkIndex: 0 })),
      cancelStart: vi.fn(async () => undefined),
      appendChunk: vi.fn(async (input) => ({ totalBytes: input.bytes.byteLength, durationMs: input.durationMs, warn: false, rollRequired: false, rolledToPartIndex: null, activePartIndex: 0, nextChunkIndex: input.chunkIndex + 1 })),
      rollPart: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn(async () => undefined), discard: vi.fn(),
    } satisfies RecordingApi
    const controller = new MediaRecorderController(recording, {
      getUserMedia: vi.fn(async () => ({ getTracks: () => [track] }) as unknown as MediaStream),
      createRecorder: () => recorder as unknown as MediaRecorder,
      now: () => clock,
    }, { onAutomaticStop: stopped })
    const snapshots: unknown[] = []
    controller.subscribe((snapshot) => snapshots.push(snapshot))

    await controller.start('meeting-1')
    clock = 7_200_000
    recorder.emit([1])
    await vi.waitFor(() => expect(recording.stop).toHaveBeenCalledOnce())
    expect(stopped).toHaveBeenCalledOnce()
    expect(snapshots).toContainEqual(expect.objectContaining({ durationMs: 7_200_000, microphone: 'active', localSave: 'saved' }))
  })

  it('attaches recovered capture at the persisted next-part cursor without reopening old container bytes', async () => {
    const recorder = new FakeMediaRecorder()
    const recording = {
      start: vi.fn(), cancelStart: vi.fn(), appendChunk: vi.fn(async (input) => ({ totalBytes: 9, durationMs: input.durationMs, warn: false, rollRequired: false, rolledToPartIndex: null, activePartIndex: 2, nextChunkIndex: 1 })),
      rollPart: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn(), discard: vi.fn(async () => undefined),
    } satisfies RecordingApi
    const controller = new MediaRecorderController(recording, {
      getUserMedia: vi.fn(async () => ({ getTracks: () => [new FakeTrack()] }) as unknown as MediaStream),
      createRecorder: () => recorder as unknown as MediaRecorder,
      now: () => 5_000,
    })

    await controller.resumeRecovered('meeting-1', { totalBytes: 8, durationMs: 5_000, warn: false, rollRequired: false, rolledToPartIndex: 2, activePartIndex: 2, nextChunkIndex: 0 })
    recorder.emit([0x1a, 0x45])
    await vi.waitFor(() => expect(recording.appendChunk).toHaveBeenCalledWith(expect.objectContaining({ partIndex: 2, chunkIndex: 0 })))
    expect(recording.start).not.toHaveBeenCalled()
    await controller.discard()
  })

  it('turns a failed explicit roll into a retryable Main stop without discarding saved bytes', async () => {
    const track = new FakeTrack()
    const recorder = new FakeMediaRecorder()
    let first = true
    const recording = {
      start: vi.fn(async () => ({ totalBytes: 0, durationMs: 0, warn: false, rolledToPartIndex: null, activePartIndex: 0, nextChunkIndex: 0 })),
      cancelStart: vi.fn(),
      appendChunk: vi.fn(async (input) => ({ totalBytes: input.bytes.byteLength, durationMs: input.durationMs, warn: first, rollRequired: first, rolledToPartIndex: null, activePartIndex: 0, nextChunkIndex: input.chunkIndex + 1 })),
      rollPart: vi.fn(async () => { first = false; throw new Error('manifest busy') }),
      pause: vi.fn(), resume: vi.fn(), stop: vi.fn(async () => undefined), discard: vi.fn(),
    } satisfies RecordingApi
    const controller = new MediaRecorderController(recording, {
      getUserMedia: vi.fn(async () => ({ getTracks: () => [track] }) as unknown as MediaStream),
      createRecorder: () => recorder as unknown as MediaRecorder,
      now: () => 10_000,
    })
    await controller.start('meeting-1')
    recorder.emit([1])
    await vi.waitFor(() => expect(controller.getSnapshot()).toMatchObject({ phase: 'failed', localSave: 'error' }))

    await expect(controller.stop()).resolves.toBeUndefined()
    expect(recording.stop).toHaveBeenCalledWith('meeting-1')
    expect(recording.discard).not.toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalledOnce()
  })
  it('serializes Opus chunks and waits for the final append before committing stop', async () => {
    const harness = createHarness()
    await harness.controller.start('meeting-1')
    expect(harness.getRecorder().start).toHaveBeenCalledWith(10_000)

    harness.setClock(10_000)
    harness.getRecorder().emit([1])
    harness.setClock(20_000)
    const stopping = harness.controller.stop()

    await vi.waitFor(() => expect(harness.calls).toEqual(['append:0', 'append:1']))
    expect(harness.recording.stop).not.toHaveBeenCalled()
    expect(harness.track.stop).not.toHaveBeenCalled()

    harness.releaseFinalAppend()
    await stopping

    expect(harness.calls).toEqual(['append:0', 'append:1', 'stop'])
    expect(harness.recording.appendChunk).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        meetingId: 'meeting-1',
        partIndex: 0,
        chunkIndex: 0,
        mimeType: 'audio/webm;codecs=opus',
        bytes: Uint8Array.from([1]),
      }),
    )
    expect(harness.recording.appendChunk).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ partIndex: 0, chunkIndex: 1, mimeType: 'audio/webm;codecs=opus' }),
    )
    expect(harness.track.stop).toHaveBeenCalledOnce()
  })

  it('keeps the session recoverable and stops tracks when an append fails', async () => {
    const harness = createHarness()
    vi.mocked(harness.recording.appendChunk).mockRejectedValueOnce(new Error('disk full'))
    await harness.controller.start('meeting-1')
    harness.getRecorder().emit([1])

    await expect(harness.controller.stop()).rejects.toMatchObject({
      state: 'capture_failed',
      cause: expect.objectContaining({ message: 'disk full' }),
    })

    expect(harness.recording.stop).not.toHaveBeenCalled()
    expect(harness.recording.discard).not.toHaveBeenCalled()
    expect(harness.track.stop).toHaveBeenCalledOnce()
  })

  it('cleans renderer state and tracks when MediaRecorder fails to start', async () => {
    const firstTrack = new FakeTrack()
    const secondTrack = new FakeTrack()
    const streams = [
      { getTracks: () => [firstTrack] } as unknown as MediaStream,
      { getTracks: () => [secondTrack] } as unknown as MediaStream,
    ]
    let createCount = 0
    const recording = {
      start: vi.fn(async () => ({ totalBytes: 0, durationMs: 0, warn: false, rolledToPartIndex: null, activePartIndex: 0, nextChunkIndex: 0 })),
      cancelStart: vi.fn(async () => undefined), appendChunk: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn(), discard: vi.fn(),
    } satisfies RecordingApi
    const controller = new MediaRecorderController(recording, {
      getUserMedia: vi.fn(async () => streams.shift()!),
      createRecorder: () => {
        const recorder = new FakeMediaRecorder()
        if (createCount++ === 0) recorder.start.mockImplementationOnce(() => { throw new Error('codec failed') })
        return recorder as unknown as MediaRecorder
      },
      now: () => 0,
    })

    await expect(controller.start('meeting-1')).rejects.toThrow('codec failed')
    expect(recording.cancelStart).toHaveBeenCalledWith('meeting-1')
    expect(firstTrack.stop).toHaveBeenCalledOnce()
    await expect(controller.start('meeting-2')).resolves.toBeUndefined()
    await controller.discard()
    expect(secondTrack.stop).toHaveBeenCalledOnce()
  })

  it('leaves pre-Main capture start cleanup to the caller when microphone access fails', async () => {
    const recording = {
      start: vi.fn(), cancelStart: vi.fn(), appendChunk: vi.fn(), pause: vi.fn(), resume: vi.fn(),
      stop: vi.fn(), discard: vi.fn(),
    } satisfies RecordingApi
    const controller = new MediaRecorderController(recording, {
      getUserMedia: vi.fn(async () => { throw new Error('permission denied') }),
      createRecorder: vi.fn(),
      now: () => 0,
    })

    await expect(controller.start('meeting-1')).rejects.toThrow('permission denied')
    expect(recording.start).not.toHaveBeenCalled()
    expect(recording.cancelStart).not.toHaveBeenCalled()
  })

  it('requires explicit discard when pristine start rollback is refused', async () => {
    const track = new FakeTrack()
    const recorder = new FakeMediaRecorder()
    recorder.start.mockImplementationOnce(() => { throw new Error('codec failed') })
    const recording = {
      start: vi.fn(async () => ({ totalBytes: 0, durationMs: 0, warn: false, rolledToPartIndex: null, activePartIndex: 0, nextChunkIndex: 0 })),
      cancelStart: vi.fn(async () => { throw new Error('session is not pristine') }),
      appendChunk: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn(),
      discard: vi.fn(async () => undefined),
    } satisfies RecordingApi
    const controller = new MediaRecorderController(recording, {
      getUserMedia: vi.fn(async () => ({ getTracks: () => [track] }) as unknown as MediaStream),
      createRecorder: () => recorder as unknown as MediaRecorder,
      now: () => 0,
    })

    await expect(controller.start('meeting-1')).rejects.toMatchObject({
      state: 'capture_failed',
      cause: expect.any(AggregateError),
    })
    expect(track.stop).toHaveBeenCalledOnce()
    expect(recording.discard).not.toHaveBeenCalled()

    await controller.discard()
    expect(recording.discard).toHaveBeenCalledWith('meeting-1')
  })

  it('preserves paused sessions without counting paused wall time as audio duration', async () => {
    const track = new FakeTrack()
    const stream = { getTracks: () => [track] } as unknown as MediaStream
    const recorder = new FakeMediaRecorder()
    let clock = 0
    const recording = {
      start: vi.fn(async () => ({ totalBytes: 0, durationMs: 0, warn: false, rolledToPartIndex: null, activePartIndex: 0, nextChunkIndex: 0 })),
      cancelStart: vi.fn(async () => undefined), appendChunk: vi.fn(async (input) => ({ totalBytes: input.bytes.byteLength, durationMs: input.durationMs, warn: false, rolledToPartIndex: null, activePartIndex: 0, nextChunkIndex: input.chunkIndex + 1 })),
      pause: vi.fn(async () => undefined),
      resume: vi.fn(async () => ({ totalBytes: 0, durationMs: 10_000, warn: false, rolledToPartIndex: null, activePartIndex: 0, nextChunkIndex: 1 })),
      stop: vi.fn(async () => undefined),
      discard: vi.fn(async () => undefined),
    } satisfies RecordingApi
    const controller = new MediaRecorderController(recording, {
      getUserMedia: vi.fn(async () => stream),
      createRecorder: () => recorder as unknown as MediaRecorder,
      now: () => clock,
    })
    await controller.start('meeting-1')
    clock = 10_000
    recorder.emit([1])
    await vi.waitFor(() => expect(recording.appendChunk).toHaveBeenCalledTimes(1))
    await controller.pause()
    clock = 20_000
    await controller.resume()
    clock = 30_000
    recorder.emit([2])
    await vi.waitFor(() => expect(recording.appendChunk).toHaveBeenCalledTimes(2))

    expect(recording.appendChunk).toHaveBeenLastCalledWith(
      expect.objectContaining({ durationMs: 20_000 }),
    )
    expect(recording.discard).not.toHaveBeenCalled()
    await controller.discard()
  })

  it('continues from the persisted active part and next chunk cursor', async () => {
    const track = new FakeTrack()
    const recorder = new FakeMediaRecorder()
    const recording = {
      start: vi.fn(async () => ({
        totalBytes: 123, durationMs: 30_000, warn: false, rolledToPartIndex: null,
        activePartIndex: 2, nextChunkIndex: 5,
      })),
      cancelStart: vi.fn(async () => undefined), appendChunk: vi.fn(async () => ({
        totalBytes: 124, durationMs: 40_000, warn: false, rolledToPartIndex: null,
        activePartIndex: 2, nextChunkIndex: 6,
      })),
      pause: vi.fn(), resume: vi.fn(), stop: vi.fn(), discard: vi.fn(async () => undefined),
    } satisfies RecordingApi
    const controller = new MediaRecorderController(recording, {
      getUserMedia: vi.fn(async () => ({ getTracks: () => [track] }) as unknown as MediaStream),
      createRecorder: () => recorder as unknown as MediaRecorder,
      now: () => 30_000,
    })
    await controller.start('meeting-1')
    recorder.emit([9])
    await vi.waitFor(() => expect(recording.appendChunk).toHaveBeenCalledOnce())

    expect(recording.appendChunk).toHaveBeenCalledWith(
      expect.objectContaining({ partIndex: 2, chunkIndex: 5 }),
    )
    await controller.discard()
  })

  it('locks start before microphone permission resolves', async () => {
    let releaseStream!: (stream: MediaStream) => void
    const streamPromise = new Promise<MediaStream>((resolve) => { releaseStream = resolve })
    const track = new FakeTrack()
    const recorder = new FakeMediaRecorder()
    const recording = {
      start: vi.fn(async () => ({ totalBytes: 0, durationMs: 0, warn: false, rolledToPartIndex: null, activePartIndex: 0, nextChunkIndex: 0 })),
      cancelStart: vi.fn(async () => undefined), appendChunk: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn(), discard: vi.fn(async () => undefined),
    } satisfies RecordingApi
    const getUserMedia = vi.fn(() => streamPromise)
    const controller = new MediaRecorderController(recording, {
      getUserMedia,
      createRecorder: () => recorder as unknown as MediaRecorder,
      now: () => 0,
    })

    const firstStart = controller.start('meeting-1')
    await expect(controller.start('meeting-2')).rejects.toThrow(/starting|active/i)
    expect(getUserMedia).toHaveBeenCalledOnce()
    releaseStream({ getTracks: () => [track] } as unknown as MediaStream)
    await firstStart
    await controller.discard()
  })

  it('rejects discard racing with stop instead of reporting the stop result as discard', async () => {
    const harness = createHarness()
    await harness.controller.start('meeting-1')
    harness.getRecorder().emit([1])
    const stopping = harness.controller.stop()

    await expect(harness.controller.discard()).rejects.toThrow(/stop.*progress|already.*stop/i)
    expect(harness.recording.discard).not.toHaveBeenCalled()
    harness.releaseFinalAppend()
    await stopping
  })

  it('retries Main finalization after stop fails without restarting MediaRecorder', async () => {
    const harness = createHarness()
    vi.mocked(harness.recording.stop)
      .mockRejectedValueOnce(new Error('database busy'))
      .mockResolvedValueOnce(undefined)
    await harness.controller.start('meeting-1')
    harness.getRecorder().emit([1])
    const firstStop = harness.controller.stop()
    harness.releaseFinalAppend()

    await expect(firstStop).rejects.toMatchObject({ state: 'stop_failed' })
    expect(harness.track.stop).toHaveBeenCalledOnce()
    await expect(harness.controller.stop()).resolves.toBeUndefined()
    expect(harness.recording.stop).toHaveBeenCalledTimes(2)
    expect(harness.track.stop).toHaveBeenCalledOnce()
  })

  it('does not poison the next terminal operation after stop is called while idle', async () => {
    const harness = createHarness()
    await expect(harness.controller.stop()).rejects.toThrow(/no recording/i)
    await harness.controller.start('meeting-1')
    const stopping = harness.controller.stop()
    harness.releaseFinalAppend()
    await expect(stopping).resolves.toBeUndefined()
  })

  it('retries the same discard after Main discard fails without reviving capture', async () => {
    const harness = createHarness()
    vi.mocked(harness.recording.discard)
      .mockRejectedValueOnce(new Error('database busy'))
      .mockResolvedValueOnce(undefined)
    await harness.controller.start('meeting-1')

    await expect(harness.controller.discard()).rejects.toMatchObject({ state: 'discard_failed' })
    expect(harness.track.stop).toHaveBeenCalledOnce()
    await expect(harness.controller.discard()).resolves.toBeUndefined()
    expect(harness.recording.discard).toHaveBeenCalledTimes(2)
    expect(harness.track.stop).toHaveBeenCalledOnce()
  })

  it('shares duplicate stop calls while rejecting a conflicting terminal action', async () => {
    const harness = createHarness()
    let releaseMainStop!: () => void
    const mainStop = new Promise<void>((resolve) => { releaseMainStop = resolve })
    vi.mocked(harness.recording.stop).mockReturnValueOnce(mainStop)
    await harness.controller.start('meeting-1')

    const first = harness.controller.stop()
    await vi.waitFor(() => expect(harness.recording.stop).toHaveBeenCalledOnce())
    const duplicate = harness.controller.stop()
    expect(duplicate).toBe(first)
    await expect(harness.controller.discard()).rejects.toThrow(/stop.*progress|already.*stop/i)
    releaseMainStop()
    await first
  })

  it('marks a MediaRecorder stop failure as capture failure and allows only discard', async () => {
    const harness = createHarness()
    await harness.controller.start('meeting-1')
    harness.getRecorder().stop = vi.fn(() => { throw new Error('recorder stopped unexpectedly') })

    await expect(harness.controller.stop()).rejects.toMatchObject({ state: 'capture_failed' })
    await expect(harness.controller.stop()).rejects.toMatchObject({ state: 'capture_failed' })
    await expect(harness.controller.discard()).resolves.toBeUndefined()
    expect(harness.recording.stop).not.toHaveBeenCalled()
    expect(harness.recording.discard).toHaveBeenCalledOnce()
  })

  it('drains an earlier append before exposing capture failure or allowing discard', async () => {
    const harness = createHarness()
    const events: string[] = []
    let releaseAppend!: () => void
    const appendGate = new Promise<void>((resolve) => { releaseAppend = resolve })
    vi.mocked(harness.recording.appendChunk).mockImplementationOnce(async (input) => {
      events.push('append:start')
      await appendGate
      events.push('append:end')
      return {
        totalBytes: input.bytes.byteLength,
        durationMs: input.durationMs,
        warn: false,
        rolledToPartIndex: null,
        activePartIndex: 0,
        nextChunkIndex: 1,
      }
    })
    vi.mocked(harness.recording.discard).mockImplementation(async () => {
      events.push('discard')
    })
    await harness.controller.start('meeting-1')
    harness.getRecorder().emit([1])
    await vi.waitFor(() => expect(events).toEqual(['append:start']))
    harness.getRecorder().stop = vi.fn(() => { throw new Error('recorder stop failed') })

    const stopping = harness.controller.stop()
    const stopResult = stopping.catch((error: unknown) => error)
    harness.getRecorder().emit([2])
    await Promise.resolve()

    expect(harness.track.stop).not.toHaveBeenCalled()
    await expect(harness.controller.discard()).rejects.toThrow(/stop.*progress|already.*stop/i)
    expect(harness.recording.discard).not.toHaveBeenCalled()

    releaseAppend()
    await expect(stopResult).resolves.toMatchObject({ state: 'capture_failed' })
    await Promise.resolve()
    expect(harness.recording.appendChunk).toHaveBeenCalledOnce()
    expect(harness.track.stop).toHaveBeenCalledOnce()

    await harness.controller.discard()
    expect(events).toEqual(['append:start', 'append:end', 'discard'])
  })

  it('reports both stop and append failures as one capture failure after draining', async () => {
    const harness = createHarness()
    let releaseAppend!: () => void
    const appendGate = new Promise<void>((resolve) => { releaseAppend = resolve })
    vi.mocked(harness.recording.appendChunk).mockImplementationOnce(async () => {
      await appendGate
      throw new Error('append failed')
    })
    await harness.controller.start('meeting-1')
    harness.getRecorder().emit([1])
    await vi.waitFor(() => expect(harness.recording.appendChunk).toHaveBeenCalledOnce())
    harness.getRecorder().stop = vi.fn(() => { throw new Error('stop failed') })

    const stopping = harness.controller.stop()
    releaseAppend()
    const error = (await stopping.catch((cause: unknown) => cause)) as RecordingTerminalError

    expect(error).toMatchObject({ state: 'capture_failed' })
    expect(error.cause).toBeInstanceOf(AggregateError)
    expect((error.cause as AggregateError).errors).toEqual([
      expect.objectContaining({ message: 'stop failed' }),
      expect.objectContaining({ message: 'append failed' }),
    ])
    await harness.controller.discard()
  })
})
