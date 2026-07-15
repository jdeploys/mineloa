import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db/database'
import { TemplateRepository } from '../../src/main/db/templateRepository'
import {
  DEFAULT_TEMPLATE_ID,
  DEFAULT_TEMPLATE_SECTIONS,
} from '../../src/main/templates/defaultTemplate'
import {
  ImmutableDefaultTemplateError,
  TemplateInUseError,
  TemplateService,
} from '../../src/main/templates/templateService'

const directories: string[] = []

function harness() {
  const root = mkdtempSync(join(tmpdir(), 'nnote-template-'))
  directories.push(root)
  const database = openDatabase(join(root, 'nnote.sqlite'))
  const service = new TemplateService(new TemplateRepository(database))
  service.seedDefault()
  return { database, service }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('TemplateService', () => {
  it('seeds the immutable default idempotently with the exact ordered Korean sections', () => {
    const { database, service } = harness()
    service.seedDefault()

    const templates = service.list()
    expect(templates).toHaveLength(1)
    expect(templates[0]).toMatchObject({ id: DEFAULT_TEMPLATE_ID, name: '기본 템플릿', isDefault: true })
    expect(templates[0]?.sections).toEqual(DEFAULT_TEMPLATE_SECTIONS)
    expect(templates[0]?.sections.map(({ title }) => title)).toEqual([
      '핵심 요약', '결정사항', '할 일', '주요 논의',
    ])
    database.close()
  })

  it('reconciles a valid but altered default exactly while leaving user templates untouched', () => {
    const root = mkdtempSync(join(tmpdir(), 'nnote-template-altered-'))
    directories.push(root)
    const database = openDatabase(join(root, 'nnote.sqlite'))
    const repository = new TemplateRepository(database)
    const timestamp = '2026-07-14T00:00:00.000Z'
    repository.save({
      id: DEFAULT_TEMPLATE_ID,
      name: '변형된 기본 템플릿',
      isDefault: true,
      sections: [{ id: '10000000-0000-4000-8000-000000000099', title: '변형', kind: 'paragraph', prompt: '변형된 지시문' }],
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    const user = repository.save({
      id: 'user-template',
      name: '사용자 템플릿',
      isDefault: false,
      sections: [{ id: '10000000-0000-4000-8000-000000000098', title: '사용자', kind: 'bullet_list', prompt: '그대로 유지' }],
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    const service = new TemplateService(repository)

    const reconciled = service.seedDefault()

    expect(reconciled).toMatchObject({ id: DEFAULT_TEMPLATE_ID, name: '기본 템플릿', isDefault: true })
    expect(reconciled.sections).toEqual(DEFAULT_TEMPLATE_SECTIONS)
    expect(service.get(user.id)).toEqual(user)
    database.close()
  })

  it('does not rewrite an already exact default', () => {
    const { database, service } = harness()
    const before = JSON.stringify(service.get(DEFAULT_TEMPLATE_ID))

    service.seedDefault()

    expect(JSON.stringify(service.get(DEFAULT_TEMPLATE_ID))).toBe(before)
    database.close()
  })

  it('creates, renames, safely reorders, and deletes a user template while preserving stable UUID section ids', () => {
    const { database, service } = harness()
    const created = service.create({
      name: ' 주간 회의 ',
      sections: [
        { title: '요약', kind: 'paragraph', prompt: '짧게 요약해 주세요.' },
        { title: '후속 작업', kind: 'action_items', prompt: '담당자와 할 일을 정리해 주세요.' },
      ],
    })
    const sectionIds = created.sections.map(({ id }) => id)

    const renamed = service.update(created.id, { name: '제품 회의' })
    const reordered = service.reorderSections(created.id, [...sectionIds].reverse())

    expect(created.name).toBe('주간 회의')
    expect(sectionIds).toEqual(sectionIds.map((id) => expect.stringMatching(/^[0-9a-f-]{36}$/)))
    expect(renamed.name).toBe('제품 회의')
    expect(reordered.sections.map(({ id }) => id)).toEqual([...sectionIds].reverse())
    expect(reordered.sections.map(({ id }) => id).sort()).toEqual([...sectionIds].sort())
    service.delete(created.id)
    expect(service.list().map(({ id }) => id)).toEqual([DEFAULT_TEMPLATE_ID])
    database.close()
  })

  it('rejects invalid user templates and unsafe reorder requests', () => {
    const { database, service } = harness()
    expect(() => service.create({ name: ' ', sections: [{ title: 'x', kind: 'paragraph', prompt: 'ok' }] })).toThrow()
    expect(() => service.create({ name: 'x', sections: [] })).toThrow()
    expect(() => service.create({ name: 'x', sections: Array.from({ length: 9 }, (_, index) => ({ title: String(index), kind: 'paragraph' as const, prompt: 'ok' })) })).toThrow()
    expect(() => service.create({ name: 'x', sections: [{ title: 'x', kind: 'paragraph', prompt: 'x'.repeat(2001) }] })).toThrow()
    const created = service.create({ name: 'x', sections: [{ title: 'x', kind: 'bullet_list', prompt: 'ok' }] })
    expect(() => service.reorderSections(created.id, ['unknown-section-id'])).toThrow()
    expect(() => service.update(created.id, { sections: [{ ...created.sections[0]!, id: 'not-a-uuid' }] })).toThrow()
    expect(service.get(created.id).sections).toEqual(created.sections)
    database.close()
  })

  it('adds and removes sections from one to eight while retaining existing IDs and requiring unique UUIDs', () => {
    const { database, service } = harness()
    const created = service.create({
      name: '가변 템플릿',
      sections: [{ title: '기존', kind: 'paragraph', prompt: '기존 내용을 유지하세요.' }],
    })
    const retainedId = created.sections[0]!.id
    const additions = Array.from({ length: 7 }, (_, index) => ({
      id: `10000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
      title: `추가 ${index + 1}`,
      kind: 'bullet_list' as const,
      prompt: `추가 ${index + 1} 내용을 정리하세요.`,
    }))

    const expanded = service.update(created.id, {
      sections: [{ ...created.sections[0]!, title: '수정된 기존' }, ...additions],
    })
    expect(expanded.sections).toHaveLength(8)
    expect(expanded.sections[0]).toMatchObject({ id: retainedId, title: '수정된 기존' })
    expect(new Set(expanded.sections.map(({ id }) => id)).size).toBe(8)

    const reduced = service.update(created.id, { sections: [expanded.sections[7]!] })
    expect(reduced.sections).toEqual([expanded.sections[7]])
    expect(() => service.update(created.id, {
      sections: [reduced.sections[0]!, { ...reduced.sections[0]!, title: '중복' }],
    })).toThrow(/unique/i)
    expect(service.get(created.id).sections).toEqual(reduced.sections)
    database.close()
  })

  it.each(['recorded', 'completed'] as const)(
    'rejects every structural update and reorder for a %s meeting while preserving its template and summary',
    (status) => {
      const { database, service } = harness()
      const created = service.create({
        name: `${status} 역사 템플릿`,
        sections: [
          { title: '요약', kind: 'paragraph', prompt: '요약하세요.' },
          { title: '논의', kind: 'bullet_list', prompt: '논의를 정리하세요.' },
        ],
      })
      const now = '2026-07-15T00:00:00.000Z'
      const meetingId = `historical-${status}`
      database.prepare('INSERT INTO meetings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(meetingId, status, now, now, 0, status, 'keep', null, 0, created.id)
      database.prepare('INSERT INTO summary_sections VALUES (?, ?, ?, ?, ?, ?)')
        .run(`summary-${status}`, meetingId, created.sections[0]!.id, 'paragraph', JSON.stringify({ text: '보존', items: [] }), 0)
      const originalTemplate = JSON.stringify(service.get(created.id))
      const originalSummary = database.prepare('SELECT * FROM summary_sections WHERE meeting_id = ?').all(meetingId)

      const operations = [
        () => service.update(created.id, { sections: [{ ...created.sections[0]!, title: '변경' }, created.sections[1]!] }),
        () => service.update(created.id, { sections: [{ ...created.sections[0]!, kind: 'bullet_list' }, created.sections[1]!] }),
        () => service.update(created.id, { sections: [created.sections[0]!] }),
        () => service.reorderSections(created.id, created.sections.map(({ id }) => id).reverse()),
      ]
      for (const operation of operations) {
        expect(operation).toThrow(TemplateInUseError)
        expect(JSON.stringify(service.get(created.id))).toBe(originalTemplate)
        expect(database.prepare('SELECT * FROM summary_sections WHERE meeting_id = ?').all(meetingId)).toEqual(originalSummary)
      }
      database.close()
    },
  )

  it('rejects more than one action_items section on create and update before persistence', () => {
    const { database, service } = harness()
    const duplicateActions = [
      { title: '할 일 1', kind: 'action_items' as const, prompt: '첫 번째' },
      { title: '할 일 2', kind: 'action_items' as const, prompt: '두 번째' },
    ]
    expect(() => service.create({ name: '잘못된 템플릿', sections: duplicateActions })).toThrow(/action_items/i)
    expect(service.list().map(({ name }) => name)).not.toContain('잘못된 템플릿')

    const created = service.create({ name: '정상 템플릿', sections: [duplicateActions[0]!] })
    const before = service.get(created.id)
    expect(() => service.update(created.id, {
      sections: [before.sections[0]!, { ...before.sections[0]!, id: '10000000-0000-4000-8000-000000000099', title: '두 번째' }],
    })).toThrow(/action_items/i)
    expect(service.get(created.id)).toEqual(before)
    database.close()
  })

  it.each(['draft', 'recording', 'recoverable', 'recorded', 'transcribing', 'summarizing', 'completed', 'failed', 'deleted'] as const)(
    'refuses deletion when a %s meeting references the template and preserves the reference',
    (status) => {
      const { database, service } = harness()
      const created = service.create({
        name: `${status} 템플릿`,
        sections: [{ title: '요약', kind: 'paragraph', prompt: '요약하세요.' }],
      })
      const now = '2026-07-15T00:00:00.000Z'
      database.prepare('INSERT INTO meetings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(`meeting-${status}`, status, now, now, 0, status, 'keep', null, 0, created.id)

      expect(() => service.delete(created.id)).toThrow(TemplateInUseError)
      expect(service.get(created.id)).toEqual(created)
      expect(database.prepare('SELECT selected_template_id FROM meetings WHERE id = ?').get(`meeting-${status}`))
        .toEqual({ selected_template_id: created.id })
      database.close()
    },
  )

  it('deletes an unreferenced custom template', () => {
    const { database, service } = harness()
    const created = service.create({
      name: '미사용 템플릿',
      sections: [{ title: '요약', kind: 'paragraph', prompt: '요약하세요.' }],
    })

    service.delete(created.id)

    expect(service.list().map(({ id }) => id)).toEqual([DEFAULT_TEMPLATE_ID])
    database.close()
  })

  it('refuses modify, reorder, and delete operations on the default and leaves it byte-for-byte unchanged', () => {
    const { database, service } = harness()
    const before = JSON.stringify(service.get(DEFAULT_TEMPLATE_ID))

    for (const operation of [
      () => service.update(DEFAULT_TEMPLATE_ID, { name: '바꿈' }),
      () => service.reorderSections(DEFAULT_TEMPLATE_ID, DEFAULT_TEMPLATE_SECTIONS.map(({ id }) => id).reverse()),
      () => service.delete(DEFAULT_TEMPLATE_ID),
    ]) {
      expect(operation).toThrow(ImmutableDefaultTemplateError)
      expect(JSON.stringify(service.get(DEFAULT_TEMPLATE_ID))).toBe(before)
    }
    database.close()
  })
})
