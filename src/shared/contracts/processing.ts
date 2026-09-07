import { z } from 'zod'
import type { AudioPolicy } from './meeting'

export const ProcessingStageSchema = z.enum(['transcribing', 'summarizing', 'cleanup'])
export type ProcessingStage = z.infer<typeof ProcessingStageSchema>

export const ProcessingErrorSchema = z.object({
  code: z.string().min(1).max(100),
  message: z.string().min(1).max(500),
}).strict()

// What a running stage can say about itself. The provider reports nothing until
// a request completes, so the only real signals are which piece is in flight
// and how long the finished pieces took; the renderer turns those into a
// countdown. Absent whenever no stage is running.
export const ProcessingProgressSchema = z.object({
  startedAt: z.string().min(1).max(40),
  unitStartedAt: z.string().min(1).max(40),
  completedUnits: z.number().int().nonnegative(),
  totalUnits: z.number().int().positive(),
  pendingAudioMs: z.number().nonnegative(),
  msPerAudioMs: z.number().positive().nullable(),
}).strict()
export type ProcessingProgress = z.infer<typeof ProcessingProgressSchema>

export const ProcessingStatusSchema = z.object({
  meetingId: z.string().min(1).max(200),
  state: z.enum(['recorded', 'transcribing', 'summarizing', 'completed', 'failed', 'cleanup_failed']),
  failedStage: ProcessingStageSchema.nullable(),
  retryable: z.boolean(),
  audioRequired: z.boolean(),
  error: ProcessingErrorSchema.nullable(),
  progress: ProcessingProgressSchema.optional(),
}).strict()
export type ProcessingStatus = z.infer<typeof ProcessingStatusSchema>

export interface ProcessingApi {
  getStatus(meetingId: string): Promise<ProcessingStatus>
  process(meetingId: string): Promise<ProcessingStatus>
  // retry resumes the stage that failed; restart throws the finished stages
  // away and runs the whole pipeline again from the saved audio, which is the
  // only way forward once a failure cannot be retried as it stands.
  retry(meetingId: string): Promise<ProcessingStatus>
  restart(meetingId: string): Promise<ProcessingStatus>
  setAudioPolicy(meetingId: string, audioPolicy: AudioPolicy): Promise<ProcessingStatus>
  onProgress(listener: (status: ProcessingStatus) => void): () => void
}
