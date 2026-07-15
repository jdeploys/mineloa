import type { SummaryTemplate, SummaryTemplateSection } from '../../shared/contracts/template'

export const DEFAULT_TEMPLATE_ID = 'default'
export const DEFAULT_TEMPLATE_SECTIONS: readonly SummaryTemplateSection[] = Object.freeze([
  Object.freeze({ id: '10000000-0000-4000-8000-000000000001', title: '핵심 요약', kind: 'paragraph', prompt: '회의의 핵심 내용을 간결하게 요약하세요.' }),
  Object.freeze({ id: '10000000-0000-4000-8000-000000000002', title: '결정사항', kind: 'bullet_list', prompt: '회의에서 확정된 결정사항만 나열하세요.' }),
  Object.freeze({ id: '10000000-0000-4000-8000-000000000003', title: '할 일', kind: 'action_items', prompt: '후속 할 일과 담당 화자를 추출하세요.' }),
  Object.freeze({ id: '10000000-0000-4000-8000-000000000004', title: '주요 논의', kind: 'bullet_list', prompt: '주요 논점과 근거를 나열하세요.' }),
])

export function createDefaultTemplate(now = new Date()): SummaryTemplate {
  const timestamp = now.toISOString()
  return {
    id: DEFAULT_TEMPLATE_ID,
    name: '기본 템플릿',
    isDefault: true,
    sections: DEFAULT_TEMPLATE_SECTIONS.map((section) => ({ ...section })),
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}
