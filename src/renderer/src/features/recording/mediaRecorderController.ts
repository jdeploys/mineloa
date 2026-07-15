import {
  MAX_RECORDING_DURATION_MS,
  RECORDING_MIME_TYPE,
  type RecordingApi,
  type RecordingProgress,
} from '../../../../shared/contracts/recording'

const TIMESLICE_MS = 10_000
const AUDIO_BITS_PER_SECOND = 20_000

interface MediaRecorderDependencies {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>
  createRecorder(stream: MediaStream, options: MediaRecorderOptions): MediaRecorder
  now(): number
}

export interface RecordingSnapshot {
  phase: 'idle' | 'recording' | 'paused' | 'saving' | 'failed'
  meetingId: string | null
  durationMs: number
  totalBytes: number
  warn: boolean
  activePartIndex: number
  partCount: number
  microphone: 'inactive' | 'active' | 'paused' | 'error'
  localSave: 'idle' | 'saving' | 'saved' | 'error'
}

interface ControllerOptions {
  onAutomaticStop?(): void
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
  | 'rolling'
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
  private rollPromise: Promise<void> | null = null
  private automaticStopStarted = false
  private durationLimitReached = false
  private snapshot: RecordingSnapshot = {
    phase: 'idle', meetingId: null, durationMs: 0, totalBytes: 0, warn: false,
    activePartIndex: 0, partCount: 0, microphone: 'inactive', localSave: 'idle',
  }
  private readonly listeners = new Set<(snapshot: RecordingSnapshot) => void>()

  constructor(
    private readonly recording: RecordingApi,
    private readonly dependencies: MediaRecorderDependencies = defaultDependencies,
    private readonly options: ControllerOptions = {},
  ) {}

  subscribe(listener: (snapshot: RecordingSnapshot) => void): () => void {
    this.listeners.add(listener)
    listener(this.snapshot)
    return () => this.listeners.delete(listener)
  }

  getSnapshot(): RecordingSnapshot { return this.snapshot }

  async start(meetingId: string): Promise<void> {
    if (this.state !== 'idle') throw new Error(`Recording is ${this.state}`)
    this.state = 'starting'

    let mainSessionStarted = false
    try {
      this.stream = await this.dependencies.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      this.appendQueue = Promise.resolve()
      this.appendFailure = null
      this.durationLimitReached = false
      const progress = await this.recording.start(meetingId)
      mainSessionStarted = true
      this.meetingId = meetingId
      this.partIndex = progress.activePartIndex
      this.chunkIndex = progress.nextChunkIndex
      this.startedAt = this.dependencies.now() - progress.durationMs
      this.pausedAt = null
      this.pausedDurationMs = 0
      this.applyProgress(progress)
      this.startRecorderPart()
      this.state = 'recording'
      this.publish({ phase: 'recording', microphone: 'active', localSave: 'saved' })
    } catch (error) {
      this.cleanupCapture()
      if (mainSessionStarted) {
        try {
          await this.recording.cancelStart(meetingId)
        } catch (rollbackError) {
          this.state = 'capture_failed'
          throw new RecordingTerminalError(
            'capture_failed',
            'Recording start rollback could not be completed; explicit discard is required',
            { cause: new AggregateError([error, rollbackError], 'Capture start and rollback failed') },
          )
        }
      }
      this.clearSession()
      throw error
    }
  }

  async resumeRecovered(meetingId: string, progress: RecordingProgress): Promise<void> {
    if (this.state !== 'idle') throw new Error(`Recording is ${this.state}`)
    this.state = 'starting'
    try {
      this.stream = await this.dependencies.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      this.appendQueue = Promise.resolve()
      this.appendFailure = null
      this.durationLimitReached = false
      this.meetingId = meetingId
      this.partIndex = progress.activePartIndex
      this.chunkIndex = progress.nextChunkIndex
      this.startedAt = this.dependencies.now() - progress.durationMs
      this.pausedAt = null
      this.pausedDurationMs = 0
      this.applyProgress(progress)
      this.startRecorderPart()
      this.state = 'recording'
      this.publish({ phase: 'recording', microphone: 'active', localSave: 'saved' })
    } catch (error) {
      this.cleanupCapture()
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
    this.publish({ phase: 'paused', microphone: 'paused', localSave: 'saved' })
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
    this.publish({ phase: 'recording', microphone: 'active', localSave: 'saved' })
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
    if (this.state === 'recording' || this.state === 'paused' || this.state === 'rolling') {
      operation = this.rollPromise === null
        ? this.finishCaptureAndApply(mode)
        : this.rollPromise.then(() => this.finishCaptureAndApply(mode))
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
    this.publish({ phase: 'saving', localSave: 'saving' })
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
      this.publish({ phase: 'failed', microphone: 'inactive', localSave: 'error' })
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
        if (this.appendFailure !== null || this.durationLimitReached) return
        const meetingId = this.meetingId
        if (meetingId === null) return
        const bytes = new Uint8Array((await blob.arrayBuffer()).slice(0))
        this.publish({ localSave: 'saving' })
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
        this.applyProgress(progress)
        this.publish({ localSave: 'saved' })
        if (progress.rollRequired) queueMicrotask(() => {
          void this.ensureRoll().catch((error: unknown) => this.handleRollFailure(error))
        })
        if (progress.maxReached || progress.durationMs >= MAX_RECORDING_DURATION_MS) {
          this.durationLimitReached = true
          queueMicrotask(() => { void this.ensureAutomaticStop() })
        }
      })
      .catch((error: unknown) => {
        this.appendFailure ??= error
        this.publish({ phase: 'failed', localSave: 'error' })
      })
  }

  private ensureRoll(): Promise<void> {
    if (this.rollPromise !== null) return this.rollPromise
    if (this.state !== 'recording') return Promise.resolve()
    const partIndex = this.partIndex
    const operation = this.performRoll(partIndex).finally(() => {
      if (this.rollPromise === operation) this.rollPromise = null
    })
    this.rollPromise = operation
    return operation
  }

  private async performRoll(partIndex: number): Promise<void> {
    const { meetingId, recorder } = this.requireCapture()
    this.state = 'rolling'
    this.publish({ phase: 'saving', localSave: 'saving' })
    await this.stopRecorderAndDrain(recorder)
    if (this.appendFailure !== null) {
      this.state = 'capture_failed'
      throw new RecordingTerminalError('capture_failed', 'A recording chunk could not be saved during part rollover', { cause: this.appendFailure })
    }
    if (this.recording.rollPart === undefined) throw new Error('Recording part rollover is unavailable')
    const progress = await this.recording.rollPart(meetingId, partIndex)
    this.partIndex = progress.activePartIndex
    this.chunkIndex = progress.nextChunkIndex
    this.applyProgress(progress)
    this.startRecorderPart()
    this.state = 'recording'
    this.publish({ phase: 'recording', microphone: 'active', localSave: 'saved' })
  }

  private handleRollFailure(_error: unknown): void {
    if (this.state === 'idle' || this.state === 'stopping') return
    this.cleanupCapture()
    this.state = 'stop_failed'
    this.publish({ phase: 'failed', microphone: 'inactive', localSave: 'error' })
    // Keep the Main session and meeting id so explicit stop retry can finalize durable bytes.
  }

  private async stopRecorderAndDrain(recorder: MediaRecorder): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onStop = () => resolve()
      recorder.addEventListener('stop', onStop, { once: true })
      try { recorder.stop() } catch (error) {
        recorder.removeEventListener('stop', onStop)
        reject(error)
      }
    })
    await this.appendQueue
    recorder.removeEventListener('dataavailable', this.onDataAvailable)
  }

  private startRecorderPart(): void {
    if (this.stream === null) throw new Error('No microphone stream is active')
    const recorder = this.dependencies.createRecorder(this.stream, {
      mimeType: RECORDING_MIME_TYPE,
      audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
    })
    this.recorder = recorder
    recorder.addEventListener('dataavailable', this.onDataAvailable)
    recorder.start(TIMESLICE_MS)
  }

  private async ensureAutomaticStop(): Promise<void> {
    if (this.automaticStopStarted || (this.state !== 'recording' && this.state !== 'rolling')) return
    this.automaticStopStarted = true
    try {
      await this.stop()
      this.options.onAutomaticStop?.()
    } catch {
      // The terminal failure remains visible through the snapshot and can be retried explicitly.
    }
  }

  private applyProgress(progress: RecordingProgress): void {
    this.publish({
      meetingId: this.meetingId,
      durationMs: progress.durationMs,
      totalBytes: progress.totalBytes,
      warn: progress.warn,
      activePartIndex: progress.activePartIndex,
      partCount: progress.activePartIndex + 1,
    })
  }

  private publish(patch: Partial<RecordingSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener(this.snapshot)
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
    this.automaticStopStarted = false
    this.durationLimitReached = false
    this.state = 'idle'
    this.publish({
      phase: 'idle', meetingId: null, durationMs: 0, totalBytes: 0, warn: false,
      activePartIndex: 0, partCount: 0, microphone: 'inactive', localSave: 'idle',
    })
  }
}
