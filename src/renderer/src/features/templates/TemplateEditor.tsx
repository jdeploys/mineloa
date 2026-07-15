import { useEffect, useState } from 'react'
import type { SummaryTemplate, SummaryTemplateSection, TemplateSectionKind, TemplatesApi } from '../../../../shared/contracts/template'

interface TemplateEditorProps {
  templates: TemplatesApi
}

function templateMutationError(error: unknown, fallback: string): string {
  if (
    typeof error === 'object' && error !== null &&
    (('code' in error && error.code === 'TEMPLATE_IN_USE') ||
      ('name' in error && error.name === 'TemplateInUseError') ||
      ('message' in error && typeof error.message === 'string' && /template.+in use/i.test(error.message)))
  ) return '회의에서 사용 중인 템플릿은 변경할 수 없습니다.'
  return fallback
}

export function TemplateEditor({ templates: api }: TemplateEditorProps) {
  const [items, setItems] = useState<SummaryTemplate[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sections, setSections] = useState<SummaryTemplateSection[]>([])
  const selected = items.find(({ id }) => id === selectedId) ?? items[0]

  useEffect(() => {
    let active = true
    api.list().then((loaded) => {
      if (!active) return
      setItems(loaded)
      setSelectedId((current) => current ?? loaded[0]?.id ?? null)
    }).catch(() => active && setError('템플릿을 불러오지 못했습니다.'))
    return () => { active = false }
  }, [api])

  useEffect(() => {
    setName(selected?.name ?? '')
    setSections(selected?.sections ?? [])
  }, [selected?.id, selected?.name, selected?.sections])

  async function saveName() {
    if (!selected || selected.isDefault) return
    try {
      const updated = await api.update(selected.id, { name })
      setItems((current) => current.map((item) => item.id === updated.id ? updated : item))
      setError(null)
    } catch (caught) {
      setError(templateMutationError(caught, '템플릿 이름을 저장하지 못했습니다.'))
    }
  }

  async function moveSection(index: number, direction: -1 | 1) {
    if (!selected || selected.isDefault) return
    const target = index + direction
    if (target < 0 || target >= sections.length) return
    const ids = sections.map(({ id }) => id)
    ;[ids[index], ids[target]] = [ids[target]!, ids[index]!]
    try {
      const updated = await api.reorderSections(selected.id, ids)
      setItems((current) => current.map((item) => item.id === updated.id ? updated : item))
      setSections(updated.sections)
    } catch (caught) {
      setError(templateMutationError(caught, '섹션 순서를 저장하지 못했습니다.'))
    }
  }

  async function createTemplate() {
    try {
      const created = await api.create({
        name: '새 템플릿',
        sections: [{ title: '요약', kind: 'paragraph', prompt: '회의 내용을 요약하세요.' }],
      })
      setItems((current) => [...current, created])
      setSelectedId(created.id)
    } catch {
      setError('템플릿을 만들지 못했습니다.')
    }
  }

  function updateSection(index: number, patch: Partial<SummaryTemplateSection>) {
    setSections((current) => current.map((section, position) => position === index ? { ...section, ...patch } : section))
  }

  function addSection() {
    if (sections.length >= 8) return
    setSections((current) => [...current, {
      id: crypto.randomUUID(), title: '새 섹션', kind: 'paragraph', prompt: '이 섹션을 작성하세요.',
    }])
  }

  function removeSection(index: number) {
    if (sections.length <= 1) return
    setSections((current) => current.filter((_section, position) => position !== index))
  }

  async function saveSections() {
    if (!selected || selected.isDefault) return
    try {
      const updated = await api.update(selected.id, { sections })
      setItems((current) => current.map((item) => item.id === updated.id ? updated : item))
      setError(null)
    } catch (caught) {
      setError(templateMutationError(caught, '템플릿 섹션을 저장하지 못했습니다.'))
    }
  }

  async function deleteTemplate() {
    if (!selected || selected.isDefault) return
    try {
      await api.delete(selected.id)
      const remaining = items.filter(({ id }) => id !== selected.id)
      setItems(remaining)
      setSelectedId(remaining[0]?.id ?? null)
    } catch {
      setError('템플릿을 삭제하지 못했습니다.')
    }
  }

  return <section className="template-layout" aria-label="요약 템플릿">
    <nav className="template-list" aria-label="템플릿 목록">
      {items.map((template) => <button key={template.id} type="button" onClick={() => setSelectedId(template.id)}>{template.name}</button>)}
      <button type="button" onClick={createTemplate}>새 템플릿</button>
    </nav>
    {error && <p role="alert">{error}</p>}
    {selected?.isDefault ? <p className="template-lock">기본 템플릿은 수정하거나 삭제할 수 없습니다.</p> : selected ? <div className="template-editor">
      <label>템플릿 이름 <input aria-label="템플릿 이름" value={name} onChange={(event) => setName(event.target.value)} /></label>
      <button type="button" onClick={saveName}>이름 저장</button>
      <ol>{sections.map((section, index) => <li className="template-section-card" key={section.id}>
        <label>섹션 {index + 1} 제목 <input aria-label={`섹션 ${index + 1} 제목`} value={section.title} onChange={(event) => updateSection(index, { title: event.target.value })} /></label>
        <label>종류 <select aria-label={`섹션 ${index + 1} 종류`} value={section.kind} onChange={(event) => updateSection(index, { kind: event.target.value as TemplateSectionKind })}><option value="paragraph">문단</option><option value="bullet_list">목록</option><option value="action_items" disabled={sections.some((candidate, position) => position !== index && candidate.kind === 'action_items')}>할 일</option></select></label>
        <label>지시문 <textarea aria-label={`섹션 ${index + 1} 지시문`} value={section.prompt} onChange={(event) => updateSection(index, { prompt: event.target.value })} /></label>
        <button type="button" aria-label="위로 이동" disabled={index === 0} onClick={() => moveSection(index, -1)}>↑</button>
        <button type="button" aria-label="아래로 이동" disabled={index === sections.length - 1} onClick={() => moveSection(index, 1)}>↓</button>
        <button type="button" aria-label="섹션 제거" disabled={sections.length <= 1} onClick={() => removeSection(index)}>제거</button>
      </li>)}</ol>
      <button type="button" disabled={sections.length >= 8} onClick={addSection}>섹션 추가</button>
      <button type="button" onClick={() => void saveSections()}>섹션 저장</button>
      <button type="button" onClick={deleteTemplate}>삭제</button>
    </div> : null}
  </section>
}
