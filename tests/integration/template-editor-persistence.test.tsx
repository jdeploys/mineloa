// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db/database'
import { TemplateRepository } from '../../src/main/db/templateRepository'
import { TemplateService } from '../../src/main/templates/templateService'
import { TemplateEditor } from '../../src/renderer/src/features/templates/TemplateEditor'
import type { TemplatesApi } from '../../src/shared/contracts/template'

const roots: string[] = []
const databases: Array<ReturnType<typeof openDatabase>> = []

afterEach(() => {
  cleanup()
  for (const database of databases.splice(0)) database.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('TemplateEditor persistence', () => {
  it('persists section additions and removals through the real template service', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nnote-template-editor-'))
    roots.push(root)
    const database = openDatabase(join(root, 'nnote.sqlite'))
    databases.push(database)
    const service = new TemplateService(new TemplateRepository(database))
    service.seedDefault()
    const custom = service.create({
      name: '사용자 템플릿',
      sections: [{ title: '기존', kind: 'paragraph', prompt: '기존 내용을 정리하세요.' }],
    })
    const api: TemplatesApi = {
      list: async () => service.list(),
      create: async (input) => service.create(input),
      update: async (id, input) => service.update(id, input),
      reorderSections: async (id, orderedIds) => service.reorderSections(id, orderedIds),
      delete: async (id) => service.delete(id),
    }
    const user = userEvent.setup()
    render(<TemplateEditor templates={api} />)

    await user.click(await screen.findByRole('button', { name: custom.name }))
    await user.click(screen.getByRole('button', { name: '섹션 추가' }))
    await user.click(screen.getByRole('button', { name: '섹션 저장' }))
    expect(service.get(custom.id).sections).toHaveLength(2)
    const addedId = service.get(custom.id).sections[1]!.id

    await user.click(screen.getAllByRole('button', { name: '섹션 제거' })[0]!)
    await user.click(screen.getByRole('button', { name: '섹션 저장' }))
    expect(service.get(custom.id).sections.map(({ id }) => id)).toEqual([addedId])
  })
})
