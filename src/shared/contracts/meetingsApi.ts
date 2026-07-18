import { z } from 'zod'
import { AudioPolicySchema, MeetingStatusSchema, SpeakerSchema, TranscriptSegmentSchema } from './meeting'
import { StoredActionItemSchema, StoredSummarySectionSchema } from './summary'

export const MeetingIdSchema = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/, 'Meeting id must be opaque')
export const MeetingTitleSchema = z.string().trim().min(1).max(200)
export const MeetingSearchInputSchema = z.object({
  query: z.string().trim().max(200).default(''),
  from: z.string().datetime({ offset: true }).nullable().default(null),
  toExclusive: z.string().datetime({ offset: true }).nullable().default(null),
}).strict().refine(({ from, toExclusive }) => from === null || toExclusive === null || from < toExclusive, {
  message: 'Search start must precede search end',
})
export type MeetingSearchInput = z.infer<typeof MeetingSearchInputSchema>

export const PublicMeetingSchema = z.object({
  id: MeetingIdSchema,
  title: z.string(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  durationMs: z.number().int().nonnegative(),
  status: MeetingStatusSchema,
  audioPolicy: AudioPolicySchema,
  hasAudio: z.boolean(),
  audioByteCount: z.number().int().nonnegative(),
  selectedTemplateId: z.string().min(1).nullable(),
}).strict()
export type PublicMeeting = z.infer<typeof PublicMeetingSchema>

export const DocumentSummarySectionSchema = StoredSummarySectionSchema.extend({
  title: z.string().trim().min(1).max(200),
}).strict()
export type DocumentSummarySection = z.infer<typeof DocumentSummarySectionSchema>

export const MeetingDocumentSchema = z.object({
  meeting: PublicMeetingSchema,
  audioUrl: z.string().startsWith('nnote-media://meeting/').nullable(),
  audioParts: z.array(z.object({
    partIndex: z.number().int().nonnegative(),
    url: z.string().startsWith('nnote-media://meeting/'),
    byteCount: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
  }).strict()).optional(),
  speakers: z.array(SpeakerSchema),
  transcript: z.array(TranscriptSegmentSchema),
  summarySections: z.array(DocumentSummarySectionSchema),
  actionItems: z.array(StoredActionItemSchema),
}).strict()
export type MeetingDocument = z.infer<typeof MeetingDocumentSchema>

export const CreateRecordingMeetingInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  audioPolicy: AudioPolicySchema.default('delete_after_processing'),
  selectedTemplateId: z.string().trim().min(1).max(200).nullable().default(null),
}).strict()
export type CreateRecordingMeetingInput = z.input<typeof CreateRecordingMeetingInputSchema>

export interface MeetingsApi {
  list(): Promise<PublicMeeting[]>
  search(input: MeetingSearchInput): Promise<PublicMeeting[]>
  get(meetingId: string): Promise<MeetingDocument>
  createRecording(input: CreateRecordingMeetingInput): Promise<PublicMeeting>
  renameMeeting(meetingId: string, title: string): Promise<PublicMeeting>
  renameSpeaker(meetingId: string, speakerId: string, displayName: string): Promise<z.infer<typeof SpeakerSchema>>
}
