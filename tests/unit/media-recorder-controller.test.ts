import { describe, expect, it, vi } from 'vitest'
import type { RecordingApi } from '../../src/shared/contracts/recording'
import { MediaRecorderController } from '../../src/renderer/src/features/recording/mediaRecorderController'

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
    start: vi.fn(async () => ({ totalBytes: 0, durationMs: 0, warn: false, rolledToPartIndex: null })),
    appendChunk: vi.fn(async (input) => {
      calls.push(`append:${input.chunkIndex}`)
      if (input.chunkIndex === 1) await finalAppendGate
      return { totalBytes: input.bytes.byteLength, durationMs: input.durationMs, warn: false, rolledToPartIndex: null }
    }),
    pause: vi.fn(async () => undefined),
    resume: vi.fn(async () => ({ totalBytes: 0, durationMs: 0, warn: false, rolledToPartIndex: null })),
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

    await expect(harness.controller.stop()).rejects.toThrow('disk full')

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
      start: vi.fn(async () => ({ totalBytes: 0, durationMs: 0, warn: false, rolledToPartIndex: null })),
      appendChunk: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn(), discard: vi.fn(),
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
    expect(firstTrack.stop).toHaveBeenCalledOnce()
    await expect(controller.start('meeting-1')).resolves.toBeUndefined()
    await controller.discard()
    expect(secondTrack.stop).toHaveBeenCalledOnce()
  })

  it('preserves paused sessions without counting paused wall time as audio duration', async () => {
    const track = new FakeTrack()
    const stream = { getTracks: () => [track] } as unknown as MediaStream
    const recorder = new FakeMediaRecorder()
    let clock = 0
    const recording = {
      start: vi.fn(async () => ({ totalBytes: 0, durationMs: 0, warn: false, rolledToPartIndex: null })),
      appendChunk: vi.fn(async (input) => ({ totalBytes: input.bytes.byteLength, durationMs: input.durationMs, warn: false, rolledToPartIndex: null })),
      pause: vi.fn(async () => undefined),
      resume: vi.fn(async () => ({ totalBytes: 0, durationMs: 10_000, warn: false, rolledToPartIndex: null })),
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
})
