export interface MarkdownMeetingDocument {
  meeting: { title: string; createdAt: string; durationMs: number }
  speakers: readonly { id: string; displayName: string }[]
  transcript: readonly { speakerId: string | null; startMs: number; endMs: number; text: string }[]
  summarySections: readonly { templateSectionId: string; title: string; kind: 'paragraph' | 'bullet_list' | 'action_items'; text: string; items: readonly string[]; orderIndex: number }[]
  actionItems: readonly { content: string; assigneeSpeakerId: string | null; dueAt: string | null; completed: boolean }[]
}

function timestamp(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export function exportMarkdown(document: MarkdownMeetingDocument): string {
  const names = new Map(document.speakers.map((speaker) => [speaker.id, speaker.displayName]))
  const lines = [`# ${document.meeting.title}`, '', `- 일시: ${document.meeting.createdAt}`, `- 길이: ${timestamp(document.meeting.durationMs)}`, '']
  for (const section of [...document.summarySections].sort((a, b) => a.orderIndex - b.orderIndex || a.templateSectionId.localeCompare(b.templateSectionId))) {
    lines.push(`## ${section.title}`, '')
    if (section.kind === 'action_items') {
      for (const item of document.actionItems) {
        const owner = item.assigneeSpeakerId === null ? '담당자 없음' : (names.get(item.assigneeSpeakerId) ?? '알 수 없는 화자')
        lines.push(`- [${item.completed ? 'x' : ' '}] ${owner} — ${item.content}${item.dueAt ? ` (${item.dueAt})` : ''}`)
      }
      if (document.actionItems.length) lines.push('')
    } else {
      if (section.text) lines.push(section.text, '')
      for (const item of section.items) lines.push(`- ${item}`)
      if (section.items.length) lines.push('')
    }
  }
  lines.push('## 전체 대화', '')
  for (const segment of document.transcript) {
    const speaker = segment.speakerId === null ? '화자 미상' : (names.get(segment.speakerId) ?? '알 수 없는 화자')
    lines.push(`[${timestamp(segment.startMs)}] ${speaker}: ${segment.text}`)
  }
  return `${lines.join('\n').trimEnd()}\n`
}
