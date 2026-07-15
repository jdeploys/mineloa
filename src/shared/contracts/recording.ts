export const RECORDING_MIME_TYPE = 'audio/webm;codecs=opus'
export const MAX_RECORDING_DURATION_MS = 2 * 60 * 60 * 1_000

export interface RecordingProgress {
  totalBytes: number
  durationMs: number
  maxReached?: boolean
  warn: boolean
  rollRequired?: boolean
  rolledToPartIndex: number | null
  activePartIndex: number
  nextChunkIndex: number
}

export interface RecordingChunk {
  meetingId: string
  partIndex: number
  chunkIndex: number
  durationMs: number
  mimeType: typeof RECORDING_MIME_TYPE
  bytes: Uint8Array
}

export interface RecordingApi {
  start(meetingId: string): Promise<RecordingProgress>
  cancelStart(meetingId: string): Promise<void>
  appendChunk(chunk: RecordingChunk): Promise<RecordingProgress>
  rollPart?(meetingId: string, partIndex: number): Promise<RecordingProgress>
  pause(meetingId: string): Promise<void>
  resume(meetingId: string): Promise<RecordingProgress>
  stop(meetingId: string): Promise<void>
  discard(meetingId: string): Promise<void>
}
