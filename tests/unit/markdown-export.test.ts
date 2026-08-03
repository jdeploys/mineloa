import { describe, expect, it } from 'vitest'
import { exportMarkdown } from '../../src/main/archive/exportMarkdown'
import { createDefaultTemplate } from '../../src/main/templates/defaultTemplate'

describe('Markdown export', () => {
  it('uses current display names and document section order without private metadata', () => {
    const markdown = exportMarkdown({
      meeting: { title: '주간 회의', createdAt: '2026-07-15T00:00:00.000Z', durationMs: 65_000 },
      speakers: [{ id: '0:B', displayName: '홍길동' }],
      transcript: [{ speakerId: '0:B', startMs: 61_000, endMs: 65_000, text: '완료했습니다' }],
      summarySections: [
        { templateSectionId: 'b', title: '결정사항', kind: 'bullet_list', text: '', items: [{ text: '출시', atMs: null }], orderIndex: 1 },
        { templateSectionId: 'a', title: '핵심 요약', kind: 'paragraph', text: '요약', items: [], orderIndex: 0 },
        { templateSectionId: 'c', title: '할 일', kind: 'action_items', text: '', items: [], orderIndex: 2 },
      ],
      actionItems: [{ content: '배포', assigneeSpeakerId: '0:B', dueAt: null, atMs: null, completed: false }],
    })
    expect(markdown).toContain('# 주간 회의')
    expect(markdown.indexOf('## 핵심 요약')).toBeLessThan(markdown.indexOf('## 결정사항'))
    expect(markdown).toContain('홍길동 — 배포')
    expect(markdown).toContain('[01:01] 홍길동: 완료했습니다')
    expect(markdown).not.toMatch(/0:B|sk-|C:\\|processing/i)
  })

  it('resolves speaker ids embedded in summary prose, not just in transcript lines', () => {
    // Summary text stores internal ids so renames stay correct. Exports used to
    // emit them verbatim, putting a raw hash where a name belongs.
    const speakerId = '2acd817c403bc39fae35aecbc10ee1cf55301248cf795a0a727131adba467b94:0:A'
    const markdown = exportMarkdown({
      meeting: { title: '주간 회의', createdAt: '2026-07-15T00:00:00.000Z', durationMs: 65_000 },
      speakers: [{ id: speakerId, displayName: '난이' }],
      transcript: [{ speakerId, startMs: 0, endMs: 1_000, text: '공유드리겠습니다' }],
      summarySections: [
        { templateSectionId: 'a', title: '핵심 요약', kind: 'paragraph', text: `[${speakerId}]가 원페이지를 수정 중`, items: [], orderIndex: 0 },
        { templateSectionId: 'b', title: '결정사항', kind: 'bullet_list', text: '', items: [{ text: `[${speakerId}]가 서면 피드백을 받기로 함`, atMs: null }], orderIndex: 1 },
      ],
      actionItems: [],
    })
    expect(markdown).toContain('[난이]가 원페이지를 수정 중')
    expect(markdown).toContain('- [난이]가 서면 피드백을 받기로 함')
    expect(markdown).not.toContain(speakerId)
  })

  it('renders action records once at the action_items template position', () => {
    const template = createDefaultTemplate(new Date('2026-07-15T00:00:00.000Z'))
    const content = new Map([
      ['핵심 요약', { text: '요약', items: [] }], ['결정사항', { text: '', items: [{ text: '결정', atMs: null }] }],
      ['할 일', { text: '', items: [] }], ['주요 논의', { text: '', items: [{ text: '논의', atMs: null }] }],
    ])
    const markdown = exportMarkdown({
      meeting: { title: '회의', createdAt: '2026-07-15T00:00:00.000Z', durationMs: 1 },
      speakers: [{ id: 'speaker', displayName: '홍길동' }], transcript: [],
      summarySections: template.sections.map((section, orderIndex) => ({ templateSectionId: section.id, title: section.title, kind: section.kind, ...(content.get(section.title)!), orderIndex })),
      actionItems: [{ content: '배포', assigneeSpeakerId: 'speaker', dueAt: null, atMs: null, completed: false }],
    })
    expect(markdown.match(/^## 할 일$/gm)).toHaveLength(1)
    expect(markdown).toContain('홍길동 — 배포')
    expect(markdown.indexOf('## 할 일')).toBeLessThan(markdown.indexOf('## 주요 논의'))
  })
})
