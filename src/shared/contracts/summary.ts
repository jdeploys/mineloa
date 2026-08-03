import { z } from 'zod'
import { TemplateSectionKindSchema } from './template'

// A summary item points back at the moment it came from, so a reader can follow
// the meeting in the order it happened. Null for summaries written before the
// model was asked to cite its source, and for an item whose citation did not
// name a real transcript segment.
export const SummaryItemSchema = z.object({
  text: z.string(),
  atMs: z.number().int().nonnegative().nullable(),
}).strict()
export type SummaryItem = z.infer<typeof SummaryItemSchema>

export const StoredSummarySectionSchema = z.object({
  id: z.string().min(1),
  meetingId: z.string().min(1),
  templateSectionId: z.string().uuid(),
  kind: TemplateSectionKindSchema,
  text: z.string(),
  items: z.array(SummaryItemSchema),
  orderIndex: z.number().int().nonnegative(),
}).strict()
export type StoredSummarySection = z.infer<typeof StoredSummarySectionSchema>

export const StoredActionItemSchema = z.object({
  id: z.string().min(1),
  meetingId: z.string().min(1),
  content: z.string().min(1),
  assigneeSpeakerId: z.string().min(1).nullable(),
  dueAt: z.string().nullable(),
  atMs: z.number().int().nonnegative().nullable(),
  completed: z.boolean(),
}).strict()
export type StoredActionItem = z.infer<typeof StoredActionItemSchema>
