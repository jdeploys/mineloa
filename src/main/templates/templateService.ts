import { randomUUID } from 'node:crypto'
import type { TemplateRepository } from '../db/templateRepository'
import {
  CreateTemplateInputSchema,
  SummaryTemplateSchema,
  UpdateTemplateInputSchema,
  type CreateTemplateInput,
  type SummaryTemplate,
  type UpdateTemplateInput,
} from '../../shared/contracts/template'
import { createDefaultTemplate, DEFAULT_TEMPLATE_ID } from './defaultTemplate'

export class ImmutableDefaultTemplateError extends Error {
  constructor() {
    super('The default template is immutable')
    this.name = 'ImmutableDefaultTemplateError'
  }
}

export class TemplateInUseError extends Error {
  readonly code = 'TEMPLATE_IN_USE'

  constructor(readonly templateId: string) {
    super(`Template ${templateId} is in use by a meeting`)
    this.name = 'TemplateInUseError'
  }
}

export class TemplateService {
  constructor(private readonly repository: TemplateRepository) {}

  seedDefault(): SummaryTemplate {
    const existing = this.repository.findById(DEFAULT_TEMPLATE_ID)
    if (existing === null) return this.repository.save(createDefaultTemplate())
    const canonical = createDefaultTemplate()
    const isExact = existing.name === canonical.name &&
      JSON.stringify(existing.sections) === JSON.stringify(canonical.sections)
    if (isExact) return existing
    return this.repository.save({
      ...canonical,
      createdAt: existing.createdAt,
    })
  }

  list(): SummaryTemplate[] {
    this.seedDefault()
    return this.repository.list()
  }

  get(id: string): SummaryTemplate {
    return this.repository.requireById(id)
  }

  create(input: CreateTemplateInput): SummaryTemplate {
    const parsed = CreateTemplateInputSchema.parse(input)
    const timestamp = new Date().toISOString()
    return this.repository.save(SummaryTemplateSchema.parse({
      id: randomUUID(),
      name: parsed.name,
      isDefault: false,
      sections: parsed.sections.map((section) => ({ ...section, id: randomUUID() })),
      createdAt: timestamp,
      updatedAt: timestamp,
    }))
  }

  update(id: string, input: UpdateTemplateInput): SummaryTemplate {
    this.assertMutable(id)
    this.assertNotInUse(id)
    const parsed = UpdateTemplateInputSchema.parse(input)
    const current = this.repository.requireById(id)
    if (parsed.sections !== undefined) {
      const nextIds = new Set(parsed.sections.map((section) => section.id))
      if (nextIds.size !== parsed.sections.length) throw new Error('Section IDs must be unique')
    }
    return this.repository.save({
      ...current,
      ...(parsed.name === undefined ? {} : { name: parsed.name }),
      ...(parsed.sections === undefined ? {} : { sections: parsed.sections }),
      updatedAt: new Date().toISOString(),
    })
  }

  reorderSections(id: string, orderedSectionIds: readonly string[]): SummaryTemplate {
    this.assertMutable(id)
    this.assertNotInUse(id)
    const current = this.repository.requireById(id)
    const unique = new Set(orderedSectionIds)
    if (
      orderedSectionIds.length !== current.sections.length ||
      unique.size !== current.sections.length ||
      current.sections.some((section) => !unique.has(section.id))
    ) {
      throw new Error('Section order must contain every section exactly once')
    }
    const byId = new Map(current.sections.map((section) => [section.id, section]))
    return this.update(id, { sections: orderedSectionIds.map((sectionId) => byId.get(sectionId)!) })
  }

  delete(id: string): void {
    this.assertMutable(id)
    this.assertNotInUse(id)
    this.repository.delete(id)
  }

  private assertNotInUse(id: string): void {
    if (this.repository.countMeetingReferences(id) > 0) throw new TemplateInUseError(id)
  }

  private assertMutable(id: string): void {
    if (id === DEFAULT_TEMPLATE_ID) throw new ImmutableDefaultTemplateError()
  }
}
