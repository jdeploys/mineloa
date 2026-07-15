import type { RecordingProgress } from './recording'
import { z } from 'zod'

export interface RecoveryItem {
  meetingId: string
  createdAt: string
  durationMs: number
  byteCount: number
  kind: 'recoverable' | 'finalizeOnly' | 'exportOnly'
}

export interface RecoveryApi {
  scan(): Promise<RecoveryItem[]>
  recover(meetingId: string): Promise<RecordingProgress>
  suspend(meetingId: string): Promise<void>
  keepAsFile(meetingId: string): Promise<void>
  exportOnly(meetingId: string): Promise<RecoveryExportResult>
  discard(meetingId: string, options: { explicitDelete: true }): Promise<void>
}

export const RecoveryExportResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('success') }).strict(),
  z.object({ status: z.literal('cancelled') }).strict(),
  z.object({ status: z.literal('failure'), code: z.literal('EXPORT_FAILED'), message: z.string() }).strict(),
])
export type RecoveryExportResult = z.infer<typeof RecoveryExportResultSchema>
