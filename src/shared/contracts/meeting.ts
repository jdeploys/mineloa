import { z } from 'zod'

export type MeetingStatus =
  | 'draft'
  | 'recording'
  | 'recoverable'
  | 'recorded'
  | 'transcribing'
  | 'summarizing'
  | 'completed'
  | 'failed'
  | 'deleted'

export const MeetingStatusSchema = z.enum([
  'draft',
  'recording',
  'recoverable',
  'recorded',
  'transcribing',
  'summarizing',
  'completed',
  'failed',
  'deleted',
])

export const AudioPolicySchema = z.enum(['keep', 'delete_after_processing'])
export type AudioPolicy = z.infer<typeof AudioPolicySchema>

export const MeetingSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  durationMs: z.number().int().nonnegative(),
  status: MeetingStatusSchema,
  audioPolicy: AudioPolicySchema,
  audioPath: z.string().min(1).nullable(),
  audioByteCount: z.number().int().nonnegative(),
  selectedTemplateId: z.string().min(1).nullable(),
})
export type Meeting = z.infer<typeof MeetingSchema>

export const TranscriptSegmentSchema = z
  .object({
    id: z.string().min(1),
    meetingId: z.string().min(1),
    speakerId: z.string().min(1).nullable(),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
    text: z.string(),
  })
  .refine(({ startMs, endMs }) => endMs >= startMs, {
    message: 'Transcript segment end must not precede its start',
    path: ['endMs'],
  })
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>

export const SpeakerSchema = z.object({
  id: z.string().min(1),
  meetingId: z.string().min(1),
  displayName: z.string().min(1),
})
export type Speaker = z.infer<typeof SpeakerSchema>
