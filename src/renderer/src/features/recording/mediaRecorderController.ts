import {
  RECORDING_MIME_TYPE,
  type RecordingApi,
} from '../../../../shared/contracts/recording'

const TIMESLICE_MS = 10_000
const AUDIO_BITS_PER_SECOND = 20_000

interface MediaRecorderDependencies {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>
  createRecorder(stream: MediaStream, options: MediaRecorderOptions): MediaRecorder
  now(): number
}

const defaultDependencies: MediaRecorderDependencies = {
  getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
  createRecorder: (stream, options) => new MediaRecorder(stream, options),
  now: () => performance.now(),
}

export type RecordingTerminalFailure = 'stop_failed' | 'discard_failed' | 'capture_failed'

export class RecordingTerminalError extends Error {
  override readonly name = 'RecordingTerminalError'

  constructor(
    readonly state: RecordingTerminalFailure,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

type ControllerState =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'paused'
  | 'stopping'
  | RecordingTerminalFailure

type TerminalMode = 'stop' | 'discard'

export class MediaRecorderController {
  private state: ControllerState = 'idle'
  private meetingId: string | null = null
  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private appendQueue: Promise<void> = Promise.resolve()
  private appendFailure: unknown = null
  private partIndex = 0
  private chunkIndex = 0
  private startedAt = 0
  private pausedAt: number | null = null
  private pausedDurationMs = 0
  private terminalMode: TerminalMode | null = null
  private terminalPromise: Promise<void> | null = null

  constructor(
    private readonly recording: RecordingApi,
    private readonly dependencies: MediaRecorderDependencies = defaultDependencies,
  ) {}

  async start(meetingId: string): Promise<void> {
    if (this.state !== 'idle') throw new Error(`Recording is ${this.state}`)
    this.state = 'starting'

    let stream: MediaStream | null = null
    try {
      stream = await this.dependencies.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      this.appendQueue = Promise.resolve()
      this.appendFailure = null
      const progress = await this.recording.start(meetingId)
      const recorder = this.dependencies.createRecorder(stream, {
        mimeType: RECORDING_MIME_TYPE,
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      })
      this.meetingId = meetingId
      this.stream = stream
      this.recorder = recorder
      this.partIndex = progress.activePartIndex
      this.chunkIndex = progress.nextChunkIndex
      this.startedAt = this.dependencies.now() - progress.durationMs
      this.pausedAt = null
      this.pausedDurationMs = 0
      recorder.addEventListener('dataavailable', this.onDataAvailable)
      recorder.start(TIMESLICE_MS)
      this.state = 'recording'
    } catch (error) {
      this.recorder?.removeEventListener('dataavailable', this.onDataAvailable)
      if (this.stream === null) {
        for (const track of stream?.getTracks() ?? []) track.stop()
      } else {
        this.cleanupCapture()
      }
      this.clearSession()
      throw error
    }
  }

  async pause(): Promise<void> {
    if (this.state !== 'recording') throw new Error('Recording is not active')
    const { meetingId, recorder } = this.requireCapture()
    recorder.pause()
    this.state = 'paused'
    this.pausedAt = this.dependencies.now()
    await this.appendQueue
    if (this.appendFailure !== null) throw this.appendFailure
    await this.recording.pause(meetingId)
  }

  async resume(): Promise<void> {
    if (this.state !== 'paused') throw new Error('Recording is not paused')
    const { meetingId, recorder } = this.requireCapture()
    await this.recording.resume(meetingId)
    recorder.resume()
    if (this.pausedAt !== null) {
      this.pausedDurationMs += this.dependencies.now() - this.pausedAt
      this.pausedAt = null
    }
    this.state = 'recording'
  }

  stop(): Promise<void> {
    return this.beginTerminal('stop')
  }

  discard(): Promise<void> {
    return this.beginTerminal('discard')
  }

  private beginTerminal(mode: TerminalMode): Promise<void> {
    if (this.terminalPromise !== null) {
      if (this.terminalMode === mode) return this.terminalPromise
      return Promise.reject(
        new Error(`Cannot ${mode} while ${this.terminalMode} is already in progress`),
      )
    }

    let operation: Promise<void>
    if (this.state === 'recording' || this.state === 'paused') {
      operation = this.finishCaptureAndApply(mode)
    } else if (mode === 'stop' && this.state === 'stop_failed') {
      operation = this.retryMainTerminal('stop')
    } else if (mode === 'discard' && this.state === 'discard_failed') {
      operation = this.retryMainTerminal('discard')
    } else if (mode === 'discard' && this.state === 'capture_failed') {
      operation = this.retryMainTerminal('discard')
    } else if (this.state === 'stop_failed' || this.state === 'discard_failed') {
      operation = Promise.reject(
        new Error(`Cannot ${mode} after ${this.state}; retry the original action`),
      )
    } else if (this.state === 'capture_failed') {
      operation = Promise.reject(
        new RecordingTerminalError('capture_failed', 'Recording capture failed; only discard is safe'),
      )
    } else {
      operation = Promise.reject(new Error('No recording is active'))
    }

    this.terminalMode = mode
    const tracked = operation.finally(() => {
      if (this.terminalPromise === tracked) {
        this.terminalPromise = null
        this.terminalMode = null
      }
    })
    this.terminalPromise = tracked
    return tracked
  }

  private async finishCaptureAndApply(mode: TerminalMode): Promise<void> {
    const { meetingId, recorder } = this.requireCapture()
    this.state = 'stopping'
    try {
      let recorderStopError: unknown = null
      let resolveStop!: () => void
      const stopEvent = new Promise<void>((resolve) => {
        resolveStop = resolve
      })
      const onStop = () => resolveStop()
      recorder.addEventListener('stop', onStop, { once: true })
      try {
        recorder.stop()
      } catch (error) {
        recorderStopError = error
        recorder.removeEventListener('stop', onStop)
        recorder.removeEventListener('dataavailable', this.onDataAvailable)
      }

      if (recorderStopError === null) await stopEvent

      await this.appendQueue

      if (recorderStopError !== null) {
        this.state = 'capture_failed'
        const cause =
          this.appendFailure === null
            ? recorderStopError
            : new AggregateError(
                [recorderStopError, this.appendFailure],
                'MediaRecorder stop and recording append both failed',
              )
        throw new RecordingTerminalError(
          'capture_failed',
          'MediaRecorder could not finish capture; only discard is safe',
          { cause },
        )
      }

      if (mode === 'stop' && this.appendFailure !== null) {
        this.state = 'capture_failed'
        throw new RecordingTerminalError(
          'capture_failed',
          'A recording chunk could not be saved; only discard is safe',
          { cause: this.appendFailure },
        )
      }

      try {
        await this.recording[mode](meetingId)
      } catch (error) {
        const failure = mode === 'stop' ? 'stop_failed' : 'discard_failed'
        this.state = failure
        throw new RecordingTerminalError(failure, `${mode} could not be completed`, {
          cause: error,
        })
      }
      this.clearSession()
    } finally {
      this.cleanupCapture()
    }
  }

  private async retryMainTerminal(mode: TerminalMode): Promise<void> {
    const meetingId = this.meetingId
    if (meetingId === null) throw new Error('No recording is active')
    this.state = 'stopping'
    try {
      await this.recording[mode](meetingId)
      this.clearSession()
    } catch (error) {
      const failure = mode === 'stop' ? 'stop_failed' : 'discard_failed'
      this.state = failure
      throw new RecordingTerminalError(failure, `${mode} could not be completed`, { cause: error })
    }
  }

  private readonly onDataAvailable = (event: Event): void => {
    const blob = (event as BlobEvent).data
    if (blob.size === 0) return
    const now = this.dependencies.now()
    const currentPauseMs = this.pausedAt === null ? 0 : now - this.pausedAt
    const durationMs = Math.max(
      0,
      Math.round(now - this.startedAt - this.pausedDurationMs - currentPauseMs),
    )
    this.appendQueue = this.appendQueue
      .then(async () => {
        if (this.appendFailure !== null) return
        const meetingId = this.meetingId
        if (meetingId === null) return
        const bytes = new Uint8Array((await blob.arrayBuffer()).slice(0))
        const progress = await this.recording.appendChunk({
          meetingId,
          partIndex: this.partIndex,
          chunkIndex: this.chunkIndex,
          durationMs,
          mimeType: RECORDING_MIME_TYPE,
          bytes,
        })
        this.partIndex = progress.activePartIndex
        this.chunkIndex = progress.nextChunkIndex
      })
      .catch((error: unknown) => {
        this.appendFailure ??= error
      })
  }

  private requireCapture(): { meetingId: string; recorder: MediaRecorder } {
    if (this.meetingId === null || this.recorder === null) throw new Error('No recording is active')
    return { meetingId: this.meetingId, recorder: this.recorder }
  }

  private cleanupCapture(): void {
    this.recorder?.removeEventListener('dataavailable', this.onDataAvailable)
    for (const track of this.stream?.getTracks() ?? []) track.stop()
    this.stream = null
    this.recorder = null
    this.pausedAt = null
    this.pausedDurationMs = 0
  }

  private clearSession(): void {
    this.cleanupCapture()
    this.meetingId = null
    this.appendFailure = null
    this.state = 'idle'
  }
}
