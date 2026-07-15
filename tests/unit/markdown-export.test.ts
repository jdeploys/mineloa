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
        { templateSectionId: 'b', title: '결정사항', kind: 'bullet_list', text: '', items: ['출시'], orderIndex: 1 },
        { templateSectionId: 'a', title: '핵심 요약', kind: 'paragraph', text: '요약', items: [], orderIndex: 0 },
        { templateSectionId: 'c', title: '할 일', kind: 'action_items', text: '', items: [], orderIndex: 2 },
      ],
      actionItems: [{ content: '배포', assigneeSpeakerId: '0:B', dueAt: null, completed: false }],
    })
    expect(markdown).toContain('# 주간 회의')
    expect(markdown.indexOf('## 핵심 요약')).toBeLessThan(markdown.indexOf('## 결정사항'))
    expect(markdown).toContain('홍길동 — 배포')
    expect(markdown).toContain('[01:01] 홍길동: 완료했습니다')
    expect(markdown).not.toMatch(/0:B|sk-|C:\\|processing/i)
  })

  it('renders action records once at the action_items template position', () => {
    const template = createDefaultTemplate(new Date('2026-07-15T00:00:00.000Z'))
    const content = new Map([
      ['핵심 요약', { text: '요약', items: [] }], ['결정사항', { text: '', items: ['결정'] }],
      ['할 일', { text: '', items: [] }], ['주요 논의', { text: '', items: ['논의'] }],
    ])
    const markdown = exportMarkdown({
      meeting: { title: '회의', createdAt: '2026-07-15T00:00:00.000Z', durationMs: 1 },
      speakers: [{ id: 'speaker', displayName: '홍길동' }], transcript: [],
      summarySections: template.sections.map((section, orderIndex) => ({ templateSectionId: section.id, title: section.title, kind: section.kind, ...(content.get(section.title)!), orderIndex })),
      actionItems: [{ content: '배포', assigneeSpeakerId: 'speaker', dueAt: null, completed: false }],
    })
    expect(markdown.match(/^## 할 일$/gm)).toHaveLength(1)
    expect(markdown).toContain('홍길동 — 배포')
    expect(markdown.indexOf('## 할 일')).toBeLessThan(markdown.indexOf('## 주요 논의'))
  })
})
