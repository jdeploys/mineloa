import type { RecordingProgress as SharedRecordingProgress } from '../../shared/contracts/recording'

const MEBIBYTE = 1024 * 1024

export const RECORDING_WARNING_BYTES = 22 * MEBIBYTE
export const RECORDING_PART_LIMIT_BYTES = 24 * MEBIBYTE

// Cloud transcription rejects one upload that carries more audio than its model
// accepts; gpt-4o-transcribe-diarize stops at 1400 seconds. Opus at the bitrate
// this app records only reaches 24 MiB near the fifty minute mark, so a size
// limit alone let a half-hour meeting land in one part that no request could
// carry. Roll on length too, far enough below the model ceiling that the last
// cluster of a part can overshoot without reaching it.
export const RECORDING_PART_LIMIT_MS = 20 * 60 * 1_000

export interface AppendChunkInput {
  meetingId: string
  partIndex: number
  chunkIndex: number
  durationMs: number
  bytes: Uint8Array
}

export type RecordingProgress = SharedRecordingProgress

export interface RecordingSizePolicy {
  warn: boolean
  rollPart: boolean
}

export function evaluateRecordingPart(
  partBytes: number,
  partDurationMs: number,
): RecordingSizePolicy {
  return {
    warn: partBytes >= RECORDING_WARNING_BYTES,
    rollPart: partBytes >= RECORDING_PART_LIMIT_BYTES || partDurationMs >= RECORDING_PART_LIMIT_MS,
  }
}
