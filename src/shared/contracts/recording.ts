export const RECORDING_MIME_TYPE = 'audio/webm;codecs=opus'

export interface RecordingProgress {
  totalBytes: number
  durationMs: number
  warn: boolean
  rolledToPartIndex: number | null
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
  appendChunk(chunk: RecordingChunk): Promise<RecordingProgress>
  pause(meetingId: string): Promise<void>
  resume(meetingId: string): Promise<RecordingProgress>
  stop(meetingId: string): Promise<void>
  discard(meetingId: string): Promise<void>
}
