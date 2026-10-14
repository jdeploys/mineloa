import type { MeetingRepository } from '../db/meetingRepository'
import type { TemplateService } from '../templates/templateService'
import type { SummaryProvider } from './providers/providerPorts'
import type { SummaryProviderId } from '../../shared/contracts/settings'
import { safeProviderError } from './providers/providerErrors'
import { buildSummaryJsonSchema, createSummaryResponseSchema } from './summarySchema'

/**
 * Orders items by when they were raised. An item with no usable citation keeps
 * the order the model gave it and sits after the timed ones, rather than being
 * dropped or guessed at.
 */
export function chronological<T extends { atMs: number | null }>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      if (left.item.atMs === right.item.atMs) return left.index - right.index
      if (left.item.atMs === null) return 1
      if (right.item.atMs === null) return -1
      return left.item.atMs - right.item.atMs
    })
    .map(({ item }) => item)
}

export class SummaryService {
  constructor(
    private readonly meetings: MeetingRepository,
    private readonly templates: TemplateService,
    private readonly resolveProvider: (providerId?: SummaryProviderId) => Pick<SummaryProvider, 'summarize'>,
  ) {}

  async summarizeMeeting(meetingId: string, providerId?: SummaryProviderId) {
    const meeting = this.meetings.requireById(meetingId)
    if (meeting.selectedTemplateId === null) throw new Error('Meeting has no summary template')
    const template = this.templates.get(meeting.selectedTemplateId)
    const speakers = this.meetings.listSpeakers(meetingId)
    const transcript = this.meetings.listTranscript(meetingId)
    const knownSpeakerIds = speakers.map(({ id }) => id)
    const input = [
      '다음 회의 전사를 제공된 템플릿에 맞춰 요약하세요.',
      '화자는 대괄호 안의 안정적인 내부 ID로만 참조하세요.',
      '각 항목의 sourceIndex에는 그 내용이 나온 전사 줄의 #번호를 적으세요.',
      '해당하는 줄을 특정할 수 없으면 null을 적으세요. 번호를 추측하지 마세요.',
      '',
      '템플릿:',
      ...template.sections.map((section, index) => `${index + 1}. [${section.id}] ${section.title} (${section.kind}): ${section.prompt}`),
      '',
      '전사:',
      ...transcript.map((segment, index) => `#${index} [${segment.speakerId ?? 'unknown'}] ${segment.text}`),
    ].join('\n')
    const provider = this.resolveProvider(providerId)
    const raw = await provider.summarize({
      input,
      schema: buildSummaryJsonSchema(template, knownSpeakerIds),
      context: {
        sections: template.sections.map(({ id, title, kind, prompt }) => ({ id, title, kind, prompt })),
        transcript: transcript.map(({ speakerId, text }, sourceIndex) => ({ sourceIndex, speakerId, text })),
        speakerIds: knownSpeakerIds,
      },
    })
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      throw safeProviderError('SUMMARY_MALFORMED_RESPONSE', 'The summary provider returned an invalid response.', false)
    }
    const parsed = createSummaryResponseSchema(template, knownSpeakerIds).safeParse(json)
    if (!parsed.success) throw safeProviderError('SUMMARY_MALFORMED_RESPONSE', 'The summary provider returned an invalid response.', false)
    const sectionById = new Map(parsed.data.sections.map((section) => [section.sectionId, section]))
    // A citation is only worth a time if it names a segment that exists. One bad
    // number costs that item its time, not the whole summary.
    const citedAtMs = (sourceIndex: number | null): number | null =>
      sourceIndex === null ? null : transcript[sourceIndex]?.startMs ?? null
    return this.meetings.completeSummary(
      meetingId,
      template.sections.map((definition, orderIndex) => {
        const section = sectionById.get(definition.id)!
        return {
          templateSectionId: definition.id,
          kind: definition.kind,
          text: section.text,
          items: chronological(section.items.map((item) => ({ text: item.text, atMs: citedAtMs(item.sourceIndex) }))),
          orderIndex,
        }
      }),
      chronological(parsed.data.actionItems.map(({ sourceIndex, ...item }) => ({
        ...item,
        atMs: citedAtMs(sourceIndex),
      }))),
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
