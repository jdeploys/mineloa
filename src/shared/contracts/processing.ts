import { z } from 'zod'

export const ProcessingStageSchema = z.enum(['transcribing', 'summarizing', 'cleanup'])
export type ProcessingStage = z.infer<typeof ProcessingStageSchema>

export const ProcessingErrorSchema = z.object({
  code: z.string().min(1).max(100),
  message: z.string().min(1).max(500),
}).strict()

export const ProcessingStatusSchema = z.object({
  meetingId: z.string().min(1).max(200),
  state: z.enum(['recorded', 'transcribing', 'summarizing', 'completed', 'failed', 'cleanup_failed']),
  failedStage: ProcessingStageSchema.nullable(),
  retryable: z.boolean(),
  audioRequired: z.boolean(),
  error: ProcessingErrorSchema.nullable(),
}).strict()
export type ProcessingStatus = z.infer<typeof ProcessingStatusSchema>

export interface ProcessingApi {
  getStatus(meetingId: string): Promise<ProcessingStatus>
  process(meetingId: string): Promise<ProcessingStatus>
  retry(meetingId: string): Promise<ProcessingStatus>
  onProgress(listener: (status: ProcessingStatus) => void): () => void
}
