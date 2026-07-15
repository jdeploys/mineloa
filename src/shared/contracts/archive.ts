import { z } from 'zod'

export const ArchiveOperationResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('success'), meetingId: z.string().min(1).optional(), includedAudio: z.boolean().optional(), audioCoverage: z.enum(['none', 'all-parts']).optional() }).strict(),
  z.object({ status: z.literal('cancelled') }).strict(),
  z.object({ status: z.literal('failure'), code: z.enum(['EXPORT_FAILED', 'IMPORT_FAILED', 'INVALID_ARCHIVE']), message: z.string() }).strict(),
])
export type ArchiveOperationResult = z.infer<typeof ArchiveOperationResultSchema>

export interface ArchiveApi {
  exportMeeting(meetingId: string): Promise<ArchiveOperationResult>
  exportMarkdown(meetingId: string): Promise<ArchiveOperationResult>
  importMeeting(): Promise<ArchiveOperationResult>
}
