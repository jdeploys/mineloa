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

export class MediaRecorderController {
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
  private stopping: Promise<void> | null = null

  constructor(
    private readonly recording: RecordingApi,
    private readonly dependencies: MediaRecorderDependencies = defaultDependencies,
  ) {}

  async start(meetingId: string): Promise<void> {
    if (this.meetingId !== null) throw new Error('A recording is already active')

    const stream = await this.dependencies.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    try {
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
      this.partIndex = progress.rolledToPartIndex ?? 0
      this.chunkIndex = 0
      this.startedAt = this.dependencies.now() - progress.durationMs
      this.pausedAt = null
      this.pausedDurationMs = 0
      recorder.addEventListener('dataavailable', this.onDataAvailable)
      recorder.start(TIMESLICE_MS)
    } catch (error) {
      this.recorder?.removeEventListener('dataavailable', this.onDataAvailable)
      for (const track of stream.getTracks()) track.stop()
      this.meetingId = null
      this.stream = null
      this.recorder = null
      throw error
    }
  }

  async pause(): Promise<void> {
    const { meetingId, recorder } = this.requireActive()
    recorder.pause()
    this.pausedAt = this.dependencies.now()
    await this.appendQueue
    if (this.appendFailure !== null) throw this.appendFailure
    await this.recording.pause(meetingId)
  }

  async resume(): Promise<void> {
    const { meetingId, recorder } = this.requireActive()
    await this.recording.resume(meetingId)
    recorder.resume()
    if (this.pausedAt !== null) {
      this.pausedDurationMs += this.dependencies.now() - this.pausedAt
      this.pausedAt = null
    }
  }

  stop(): Promise<void> {
    if (this.stopping === null) this.stopping = this.finish(true)
    return this.stopping
  }

  discard(): Promise<void> {
    if (this.stopping === null) this.stopping = this.finish(false)
    return this.stopping
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
        if (progress.rolledToPartIndex !== null) {
          this.partIndex = progress.rolledToPartIndex
          this.chunkIndex = 0
        } else {
          this.chunkIndex += 1
        }
      })
      .catch((error: unknown) => {
        this.appendFailure ??= error
      })
  }

  private async finish(commit: boolean): Promise<void> {
    const { meetingId, recorder } = this.requireActive()
    try {
      await new Promise<void>((resolve) => {
        recorder.addEventListener('stop', () => resolve(), { once: true })
        recorder.stop()
      })
      await this.appendQueue

      if (commit) {
        if (this.appendFailure !== null) throw this.appendFailure
        await this.recording.stop(meetingId)
      } else {
        await this.recording.discard(meetingId)
      }
    } finally {
      recorder.removeEventListener('dataavailable', this.onDataAvailable)
      for (const track of this.stream?.getTracks() ?? []) track.stop()
      this.meetingId = null
      this.stream = null
      this.recorder = null
      this.pausedAt = null
      this.pausedDurationMs = 0
      this.stopping = null
    }
  }

  private requireActive(): { meetingId: string; recorder: MediaRecorder } {
    if (this.meetingId === null || this.recorder === null) throw new Error('No recording is active')
    return { meetingId: this.meetingId, recorder: this.recorder }
  }
}
