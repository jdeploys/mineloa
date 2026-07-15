import { z } from 'zod'
import { TemplateSectionKindSchema } from './template'

export const StoredSummarySectionSchema = z.object({
  id: z.string().min(1),
  meetingId: z.string().min(1),
  templateSectionId: z.string().uuid(),
  kind: TemplateSectionKindSchema,
  text: z.string(),
  items: z.array(z.string()),
  orderIndex: z.number().int().nonnegative(),
}).strict()
export type StoredSummarySection = z.infer<typeof StoredSummarySectionSchema>

export const StoredActionItemSchema = z.object({
  id: z.string().min(1),
  meetingId: z.string().min(1),
  content: z.string().min(1),
  assigneeSpeakerId: z.string().min(1).nullable(),
  dueAt: z.string().nullable(),
  completed: z.boolean(),
}).strict()
export type StoredActionItem = z.infer<typeof StoredActionItemSchema>
