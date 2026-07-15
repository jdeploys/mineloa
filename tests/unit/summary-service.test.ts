import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAiSummaryGateway } from '../../src/main/ai/openAiGateway'
import { SummaryService } from '../../src/main/ai/summaryService'
import { buildSummaryJsonSchema } from '../../src/main/ai/summarySchema'
import { openDatabase } from '../../src/main/db/database'
import { MeetingRepository } from '../../src/main/db/meetingRepository'
import { TemplateRepository } from '../../src/main/db/templateRepository'
import { TemplateService } from '../../src/main/templates/templateService'

const directories: string[] = []

function harness() {
  const root = mkdtempSync(join(tmpdir(), 'nnote-summary-'))
  directories.push(root)
  const database = openDatabase(join(root, 'nnote.sqlite'))
  const meetings = new MeetingRepository(database)
  const templates = new TemplateService(new TemplateRepository(database))
  templates.seedDefault()
  const template = templates.create({
    name: 'Custom',
    sections: [
      { title: '요약', kind: 'paragraph', prompt: '요약하세요.' },
      { title: '논의', kind: 'bullet_list', prompt: '논의를 나열하세요.' },
      { title: '할 일', kind: 'action_items', prompt: '할 일을 찾으세요.' },
    ],
  })
  const now = '2026-07-14T12:00:00.000Z'
  meetings.create({ id: 'meeting-1', title: 'Planning', createdAt: now, updatedAt: now, durationMs: 2_000, status: 'summarizing', audioPolicy: 'keep', audioPath: 'meeting.webm', audioByteCount: 10, selectedTemplateId: template.id })
  database.prepare('INSERT INTO speakers (id, meeting_id, display_name) VALUES (?, ?, ?), (?, ?, ?)').run('0:A', 'meeting-1', 'Speaker A', '0:B', 'meeting-1', 'Speaker B')
  meetings.replaceTranscript('meeting-1', [
    { id: 's1', meetingId: 'meeting-1', speakerId: '0:A', startMs: 0, endMs: 1_000, text: 'Ship it.' },
    { id: 's2', meetingId: 'meeting-1', speakerId: '0:B', startMs: 1_000, endMs: 2_000, text: 'I will.' },
  ])
  return { database, meetings, templates, template }
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('OpenAiSummaryGateway', () => {
  it('uses gpt-5-mini and the exact Responses API strict structured-output boundary', async () => {
    const create = vi.fn(async () => ({ status: 'completed', output_text: JSON.stringify({ sections: [], actionItems: [] }), output: [] }))
    const gateway = new OpenAiSummaryGateway(
      { get: vi.fn().mockResolvedValue('sk-secret'), set: vi.fn(), delete: vi.fn() },
      () => ({ responses: { create } }),
    )
    const schema = { type: 'object', additionalProperties: false, required: ['sections', 'actionItems'], properties: { sections: { type: 'array' }, actionItems: { type: 'array' } } }

    await gateway.summarize({ input: 'transcript', schema })

    expect(create).toHaveBeenCalledWith({
      model: 'gpt-5-mini',
      input: 'transcript',
      text: { format: { type: 'json_schema', name: 'nnote_meeting_summary', strict: true, schema } },
    })
  })

  it.each([
    ['refusal', { status: 'completed', output_text: '', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }],
    ['incomplete', { status: 'incomplete', output_text: '{}', output: [] }],
    ['missing output', { status: 'completed', output_text: '', output: [] }],
  ])('rejects %s safely', async (_label, response) => {
    const gateway = new OpenAiSummaryGateway(
      { get: vi.fn().mockResolvedValue('placeholder'), set: vi.fn(), delete: vi.fn() },
      () => ({ responses: { create: vi.fn(async () => response) } }),
    )
    await expect(gateway.summarize({ input: 'x', schema: {} })).rejects.toMatchObject({
      code: expect.stringMatching(/^OPENAI_/),
      retryable: expect.any(Boolean),
    })
  })

  it.each([400, 413])('maps Responses API HTTP %i to a fixed summary-safe error without provider details', async (status) => {
    const gateway = new OpenAiSummaryGateway(
      { get: vi.fn().mockResolvedValue('placeholder'), set: vi.fn(), delete: vi.fn() },
      () => ({ responses: { create: vi.fn(async () => {
        throw Object.assign(new Error('provider canary invalid summary request'), { status })
      }) } }),
    )

    const failure = await gateway.summarize({ input: 'x', schema: {} }).catch((error: unknown) => error)

    expect(failure).toMatchObject({
      code: 'OPENAI_INVALID_SUMMARY_REQUEST',
      message: 'OpenAI could not accept the summary request.',
      retryable: false,
    })
    expect(String(failure)).not.toContain('provider canary')
    expect(String(failure)).not.toContain('audio')
  })
})

describe('SummaryService', () => {
  it('builds a recursively closed schema restricted to template sections and internal speakers', () => {
    const h = harness()
    const schema = buildSummaryJsonSchema(h.template, ['0:A', '0:B']) as any
    expect(schema.additionalProperties).toBe(false)
    expect(schema.required).toEqual(['sections', 'actionItems'])
    expect(schema.properties.sections.items.additionalProperties).toBe(false)
    expect(schema.properties.sections.items.required).toEqual(['sectionId', 'kind', 'text', 'items'])
    expect(schema.properties.sections.items.properties.sectionId.enum).toEqual(h.template.sections.map(({ id }) => id))
    expect(schema.properties.actionItems.items.additionalProperties).toBe(false)
    expect(schema.properties.actionItems.items.required).toEqual(['content', 'assigneeSpeakerId', 'dueAt'])
    expect(schema.properties.actionItems.items.properties.assigneeSpeakerId.anyOf[0].enum).toEqual(['0:A', '0:B'])
    h.database.close()
  })

  it('stores internal speaker references and resolves the current display name without changing transcript bytes', async () => {
    const h = harness()
    const before = JSON.stringify(h.meetings.listTranscript('meeting-1'))
    const gateway = {
      summarize: vi.fn(async () => JSON.stringify({
        sections: [
          { sectionId: h.template.sections[0]?.id, kind: 'paragraph', text: 'Ship approved', items: [] },
          { sectionId: h.template.sections[1]?.id, kind: 'bullet_list', text: '', items: ['Release discussed'] },
          { sectionId: h.template.sections[2]?.id, kind: 'action_items', text: '', items: [] },
        ],
        actionItems: [{ content: 'Deploy', assigneeSpeakerId: '0:B', dueAt: null }],
      })),
    }
    const service = new SummaryService(h.meetings, h.templates, gateway)

    await service.summarizeMeeting('meeting-1')
    expect(service.renderMeeting('meeting-1').actionItems[0]?.assigneeDisplayName).toBe('Speaker B')
    expect(h.meetings.listActionItems('meeting-1')[0]?.assigneeSpeakerId).toBe('0:B')

    h.meetings.renameSpeaker('meeting-1', '0:B', '홍길동')

    expect(service.renderMeeting('meeting-1').actionItems[0]?.assigneeDisplayName).toBe('홍길동')
    expect(JSON.stringify(h.meetings.listTranscript('meeting-1'))).toBe(before)
    expect(gateway.summarize).toHaveBeenCalledTimes(1)
    h.database.close()
  })

  it.each([
    ['unknown speaker', (h: ReturnType<typeof harness>) => ({ sections: h.template.sections.map((section) => ({ sectionId: section.id, kind: section.kind, text: '', items: [] })), actionItems: [{ content: 'x', assigneeSpeakerId: '0:UNKNOWN', dueAt: null }] })],
    ['bad section', (h: ReturnType<typeof harness>) => ({ sections: [{ sectionId: 'bad', kind: 'paragraph', text: 'x', items: [] }], actionItems: [] })],
  ])('rejects %s before the transaction and preserves prior summary and transcript', async (_label, makeResponse) => {
    const h = harness()
    h.database.prepare('INSERT INTO summary_sections (id, meeting_id, template_section_id, kind, content_json, order_index) VALUES (?, ?, ?, ?, ?, ?)').run('old', 'meeting-1', h.template.sections[0]?.id, 'paragraph', JSON.stringify({ text: 'Old', items: [] }), 0)
    const beforeTranscript = JSON.stringify(h.meetings.listTranscript('meeting-1'))
    const beforeSummary = JSON.stringify(h.meetings.listSummarySections('meeting-1'))
    const service = new SummaryService(h.meetings, h.templates, { summarize: vi.fn(async () => JSON.stringify(makeResponse(h))) })

    await expect(service.summarizeMeeting('meeting-1')).rejects.toMatchObject({ code: 'OPENAI_MALFORMED_SUMMARY' })

    expect(JSON.stringify(h.meetings.listTranscript('meeting-1'))).toBe(beforeTranscript)
    expect(JSON.stringify(h.meetings.listSummarySections('meeting-1'))).toBe(beforeSummary)
    h.database.close()
  })

  it('preserves the prior summary and transcript when the safe gateway fails', async () => {
    const h = harness()
    h.database.prepare('INSERT INTO summary_sections (id, meeting_id, template_section_id, kind, content_json, order_index) VALUES (?, ?, ?, ?, ?, ?)').run('old', 'meeting-1', h.template.sections[0]?.id, 'paragraph', JSON.stringify({ text: 'Old', items: [] }), 0)
    const beforeTranscript = JSON.stringify(h.meetings.listTranscript('meeting-1'))
    const beforeSummary = JSON.stringify(h.meetings.listSummarySections('meeting-1'))
    const gateway = new OpenAiSummaryGateway(
      { get: vi.fn().mockResolvedValue('placeholder'), set: vi.fn(), delete: vi.fn() },
      () => ({ responses: { create: vi.fn(async () => {
        throw Object.assign(new Error('provider canary invalid summary request'), { status: 400 })
      }) } }),
    )
    const service = new SummaryService(h.meetings, h.templates, gateway)

    await expect(service.summarizeMeeting('meeting-1')).rejects.toMatchObject({
      code: 'OPENAI_INVALID_SUMMARY_REQUEST',
      message: 'OpenAI could not accept the summary request.',
      retryable: false,
    })
    expect(JSON.stringify(h.meetings.listTranscript('meeting-1'))).toBe(beforeTranscript)
    expect(JSON.stringify(h.meetings.listSummarySections('meeting-1'))).toBe(beforeSummary)
    h.database.close()
  })

  it('builds the prompt with stable internal IDs rather than display names', async () => {
    const h = harness()
    h.meetings.renameSpeaker('meeting-1', '0:B', '홍길동')
    const summarize = vi.fn(async () => JSON.stringify({ sections: h.template.sections.map((section) => ({ sectionId: section.id, kind: section.kind, text: '', items: [] })), actionItems: [] }))
    await new SummaryService(h.meetings, h.templates, { summarize }).summarizeMeeting('meeting-1')
    const input = (summarize.mock.calls as unknown as Array<[{ input: string }]>)[0]![0].input
    expect(input).toContain('[0:B] I will.')
    expect(input).not.toContain('홍길동')
    h.database.close()
  })
})
