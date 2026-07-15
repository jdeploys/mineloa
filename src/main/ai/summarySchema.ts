import { z } from 'zod'
import type { SummaryTemplate } from '../../shared/contracts/template'

export interface SummaryJsonSchema {
  [key: string]: unknown
}

export function buildSummaryJsonSchema(
  template: SummaryTemplate,
  speakerIds: readonly string[],
): SummaryJsonSchema {
  const nullableSpeaker = speakerIds.length === 0
    ? { type: 'null' }
    : { anyOf: [{ type: 'string', enum: [...speakerIds] }, { type: 'null' }] }
  return {
    type: 'object',
    additionalProperties: false,
    required: ['sections', 'actionItems'],
    properties: {
      sections: {
        type: 'array',
        minItems: template.sections.length,
        maxItems: template.sections.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['sectionId', 'kind', 'text', 'items'],
          properties: {
            sectionId: { type: 'string', enum: template.sections.map(({ id }) => id) },
            kind: { type: 'string', enum: ['paragraph', 'bullet_list', 'action_items'] },
            text: { type: 'string' },
            items: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      actionItems: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['content', 'assigneeSpeakerId', 'dueAt'],
          properties: {
            content: { type: 'string', minLength: 1 },
            assigneeSpeakerId: nullableSpeaker,
            dueAt: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          },
        },
      },
    },
  }
}

export function createSummaryResponseSchema(template: SummaryTemplate, speakerIds: readonly string[]) {
  const sectionIds = new Set(template.sections.map(({ id }) => id))
  const speakers = new Set(speakerIds)
  return z.object({
    sections: z.array(z.object({
      sectionId: z.string(),
      kind: z.enum(['paragraph', 'bullet_list', 'action_items']),
      text: z.string(),
      items: z.array(z.string()),
    }).strict()),
    actionItems: z.array(z.object({
      content: z.string().min(1),
      assigneeSpeakerId: z.string().nullable(),
      dueAt: z.string().nullable(),
    }).strict()),
  }).strict().superRefine((value, context) => {
    if (value.sections.length !== template.sections.length) {
      context.addIssue({ code: 'custom', message: 'Every template section is required', path: ['sections'] })
    }
    const seen = new Set<string>()
    for (const [index, section] of value.sections.entries()) {
      const expected = template.sections.find(({ id }) => id === section.sectionId)
      if (!sectionIds.has(section.sectionId) || expected === undefined) {
        context.addIssue({ code: 'custom', message: 'Unknown template section', path: ['sections', index, 'sectionId'] })
      } else if (expected.kind !== section.kind) {
        context.addIssue({ code: 'custom', message: 'Section kind does not match template', path: ['sections', index, 'kind'] })
      }
      if (seen.has(section.sectionId)) {
        context.addIssue({ code: 'custom', message: 'Duplicate template section', path: ['sections', index, 'sectionId'] })
      }
      seen.add(section.sectionId)
    }
    for (const [index, item] of value.actionItems.entries()) {
      if (item.assigneeSpeakerId !== null && !speakers.has(item.assigneeSpeakerId)) {
        context.addIssue({ code: 'custom', message: 'Unknown speaker', path: ['actionItems', index, 'assigneeSpeakerId'] })
      }
    }
  })
}
