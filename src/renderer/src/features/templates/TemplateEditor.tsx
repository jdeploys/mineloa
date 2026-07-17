import { useEffect, useRef, useState } from 'react'
import type { SummaryTemplate, SummaryTemplateSection, TemplateSectionKind, TemplatesApi } from '../../../../shared/contracts/template'
import { InlineNotice } from '../../components/feedback/InlineNotice'
import { FieldHelp } from '../../components/help/FieldHelp'
import { ActionBar } from '../../components/layout/ActionBar'
import { Button } from '../../components/ui/Button'
import { SurfaceCard } from '../../components/ui/SurfaceCard'

interface TemplateEditorProps {
  templates: TemplatesApi
}

type TemplateOperation =
  | { kind: 'create' }
  | { kind: 'save' }
  | { kind: 'reorder'; sectionId: string; direction: -1 | 1 }
  | { kind: 'delete' }

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
  const [pendingOperation, setPendingOperation] = useState<TemplateOperation | null>(null)
  const pendingOperationRef = useRef<TemplateOperation | null>(null)
  const selected = items.find(({ id }) => id === selectedId) ?? items[0]
  const busy = pendingOperation !== null

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

  async function runOperation(operation: TemplateOperation, task: () => Promise<void>) {
    if (pendingOperationRef.current !== null) return
    pendingOperationRef.current = operation
    setPendingOperation(operation)
    try {
      await task()
    } finally {
      pendingOperationRef.current = null
      setPendingOperation(null)
    }
  }

  async function saveTemplate() {
    if (!selected || selected.isDefault) return
    await runOperation({ kind: 'save' }, async () => {
      try {
        const updated = await api.update(selected.id, { name, sections })
        setItems((current) => current.map((item) => item.id === updated.id ? updated : item))
        setError(null)
      } catch (caught) {
        setError(templateMutationError(caught, '템플릿을 저장하지 못했습니다.'))
      }
    })
  }

  async function moveSection(index: number, direction: -1 | 1) {
    if (!selected || selected.isDefault) return
    const target = index + direction
    if (target < 0 || target >= sections.length) return
    const ids = sections.map(({ id }) => id)
    ;[ids[index], ids[target]] = [ids[target]!, ids[index]!]
    await runOperation({ kind: 'reorder', sectionId: sections[index]!.id, direction }, async () => {
      try {
        const updated = await api.reorderSections(selected.id, ids)
        setItems((current) => current.map((item) => item.id === updated.id ? updated : item))
        setSections(updated.sections)
      } catch (caught) {
        setError(templateMutationError(caught, '섹션 순서를 저장하지 못했습니다.'))
      }
    })
  }

  async function createTemplate() {
    await runOperation({ kind: 'create' }, async () => {
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
    })
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

  async function deleteTemplate() {
    if (!selected || selected.isDefault) return
    await runOperation({ kind: 'delete' }, async () => {
      try {
        await api.delete(selected.id)
        const remaining = items.filter(({ id }) => id !== selected.id)
        setItems(remaining)
        setSelectedId(remaining[0]?.id ?? null)
        setError(null)
      } catch (caught) {
        setError(templateMutationError(caught, '템플릿을 삭제하지 못했습니다.'))
      }
    })
  }

  return <section className="template-layout" aria-label="요약 템플릿" aria-busy={busy}>
    <SurfaceCard as="div" className="template-master" labelledBy="template-list-heading">
      <div className="template-master-heading">
        <h2 id="template-list-heading">템플릿 목록</h2>
        <FieldHelp>회의에 적용할 요약 구조를 선택하세요.</FieldHelp>
      </div>
      <nav className="template-list" aria-label="템플릿 목록">
        {items.map((template) => <Button
          key={template.id}
          type="button"
          variant="tertiary"
          aria-current={selected?.id === template.id ? 'true' : undefined}
          disabled={busy}
          onClick={() => setSelectedId(template.id)}
        >{template.name}</Button>)}
      </nav>
      <Button type="button" disabled={busy} onClick={createTemplate}>{pendingOperation?.kind === 'create' ? '생성 중…' : '새 템플릿'}</Button>
    </SurfaceCard>

    <div className="template-detail">
      {error && <InlineNotice tone="error" title="템플릿 작업 실패"><p>{error}</p></InlineNotice>}
      {selected?.isDefault ? <SurfaceCard as="div" className="template-lock" labelledBy="template-lock-heading">
        <h2 id="template-lock-heading">{selected.name}</h2>
        <InlineNotice title="읽기 전용 템플릿">
          <p>기본 템플릿은 수정하거나 삭제할 수 없습니다.</p>
        </InlineNotice>
      </SurfaceCard> : selected ? <SurfaceCard as="div" className="template-editor" labelledBy="template-editor-heading">
        <div className="template-editor-heading">
          <div>
            <h2 id="template-editor-heading">템플릿 편집</h2>
            <FieldHelp>이름과 현재 섹션을 한 번에 저장합니다.</FieldHelp>
          </div>
        </div>

        <label className="template-name-field">템플릿 이름
          <input aria-label="템플릿 이름" value={name} disabled={busy} onChange={(event) => setName(event.target.value)} />
        </label>

        <div className="template-sections-heading">
          <div>
            <h3>요약 섹션</h3>
            <FieldHelp>섹션은 1개 이상 8개 이하로 구성할 수 있습니다.</FieldHelp>
          </div>
          <span>{sections.length} / 8</span>
        </div>

        <ol className="template-sections">{sections.map((section, index) => <li className="template-section-card" key={section.id}>
          <div className="template-section-heading">
            <h3>섹션 {index + 1}</h3>
            <div className="template-section-actions">
              {([-1, 1] as const).map((direction) => {
                const moving = pendingOperation?.kind === 'reorder' && pendingOperation.sectionId === section.id && pendingOperation.direction === direction
                const edge = direction === -1 ? index === 0 : index === sections.length - 1
                const label = direction === -1 ? '위로 이동' : '아래로 이동'
                return <Button key={direction} type="button" variant="tertiary" aria-label={moving ? '정렬 중…' : label} disabled={busy || edge} onClick={() => moveSection(index, direction)}>{moving ? '정렬 중…' : direction === -1 ? '위로' : '아래로'}</Button>
              })}
              <Button type="button" variant="tertiary" aria-label="섹션 제거" disabled={busy || sections.length <= 1} onClick={() => removeSection(index)}>제거</Button>
            </div>
          </div>
          <div className="template-section-fields">
            <label>제목
              <input aria-label={`섹션 ${index + 1} 제목`} value={section.title} disabled={busy} onChange={(event) => updateSection(index, { title: event.target.value })} />
            </label>
            <label>종류
              <select aria-label={`섹션 ${index + 1} 종류`} value={section.kind} disabled={busy} onChange={(event) => updateSection(index, { kind: event.target.value as TemplateSectionKind })}>
                <option value="paragraph">문단</option>
                <option value="bullet_list">목록</option>
                <option value="action_items" disabled={sections.some((candidate, position) => position !== index && candidate.kind === 'action_items')}>할 일</option>
              </select>
            </label>
          </div>
          <label className="template-prompt-field">지시문
            <textarea aria-label={`섹션 ${index + 1} 지시문`} value={section.prompt} disabled={busy} onChange={(event) => updateSection(index, { prompt: event.target.value })} />
          </label>
        </li>)}</ol>

        <ActionBar>
          <Button type="button" disabled={busy || sections.length >= 8} onClick={addSection}>섹션 추가</Button>
          <Button type="button" variant="primary" disabled={busy} onClick={() => void saveTemplate()}>{pendingOperation?.kind === 'save' ? '저장 중…' : '템플릿 저장'}</Button>
        </ActionBar>

        <div className="danger-zone template-danger-zone">
          <div>
            <strong>템플릿 삭제</strong>
            <p>이 템플릿을 목록에서 영구적으로 삭제합니다.</p>
          </div>
          <Button type="button" variant="danger" disabled={busy} onClick={() => void deleteTemplate()}>{pendingOperation?.kind === 'delete' ? '삭제 중…' : '템플릿 삭제'}</Button>
        </div>
      </SurfaceCard> : null}
    </div>
  </section>
}
