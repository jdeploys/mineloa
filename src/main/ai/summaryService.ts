import type { MeetingRepository } from '../db/meetingRepository'
import type { TemplateService } from '../templates/templateService'
import type { OpenAiSummaryGatewayPort } from './openAiGateway'
import { safeOpenAiError } from './openAiErrors'
import { buildSummaryJsonSchema, createSummaryResponseSchema } from './summarySchema'

export class SummaryService {
  constructor(
    private readonly meetings: MeetingRepository,
    private readonly templates: TemplateService,
    private readonly gateway: OpenAiSummaryGatewayPort,
  ) {}

  async summarizeMeeting(meetingId: string) {
    const meeting = this.meetings.requireById(meetingId)
    if (meeting.selectedTemplateId === null) throw new Error('Meeting has no summary template')
    const template = this.templates.get(meeting.selectedTemplateId)
    const speakers = this.meetings.listSpeakers(meetingId)
    const transcript = this.meetings.listTranscript(meetingId)
    const knownSpeakerIds = speakers.map(({ id }) => id)
    const input = [
      '다음 회의 전사를 제공된 템플릿에 맞춰 요약하세요.',
      '화자는 대괄호 안의 안정적인 내부 ID로만 참조하세요.',
      '',
      '템플릿:',
      ...template.sections.map((section, index) => `${index + 1}. [${section.id}] ${section.title} (${section.kind}): ${section.prompt}`),
      '',
      '전사:',
      ...transcript.map((segment) => `[${segment.speakerId ?? 'unknown'}] ${segment.text}`),
    ].join('\n')
    const raw = await this.gateway.summarize({
      input,
      schema: buildSummaryJsonSchema(template, knownSpeakerIds),
    })
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      throw safeOpenAiError('OPENAI_MALFORMED_SUMMARY')
    }
    const parsed = createSummaryResponseSchema(template, knownSpeakerIds).safeParse(json)
    if (!parsed.success) throw safeOpenAiError('OPENAI_MALFORMED_SUMMARY')
    const sectionById = new Map(parsed.data.sections.map((section) => [section.sectionId, section]))
    return this.meetings.completeSummary(
      meetingId,
      template.sections.map((definition, orderIndex) => {
        const section = sectionById.get(definition.id)!
        return {
          templateSectionId: definition.id,
          kind: definition.kind,
          text: section.text,
          items: section.items,
          orderIndex,
        }
      }),
      parsed.data.actionItems.map((item) => ({ ...item })),
    )
  }

  renderMeeting(meetingId: string) {
    const displayNames = new Map(this.meetings.listSpeakers(meetingId).map((speaker) => [speaker.id, speaker.displayName]))
    return {
      sections: this.meetings.listSummarySections(meetingId),
      actionItems: this.meetings.listActionItems(meetingId).map((item) => ({
        ...item,
        assigneeDisplayName: item.assigneeSpeakerId === null ? null : displayNames.get(item.assigneeSpeakerId) ?? null,
      })),
    }
  }
}
