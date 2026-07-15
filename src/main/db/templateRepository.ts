import type Database from 'better-sqlite3'
import {
  SummaryTemplateSchema,
  type SummaryTemplate,
} from '../../shared/contracts/template'

interface TemplateRow {
  id: string
  name: string
  sections_json: string
  created_at: string
  updated_at: string
}

function toTemplate(row: TemplateRow): SummaryTemplate {
  return SummaryTemplateSchema.parse({
    id: row.id,
    name: row.name,
    isDefault: row.id === 'default',
    sections: JSON.parse(row.sections_json) as unknown,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

export class TemplateRepository {
  constructor(private readonly database: Database.Database) {}

  save(value: SummaryTemplate): SummaryTemplate {
    const template = SummaryTemplateSchema.parse(value)
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database
        .prepare(
          `INSERT INTO summary_templates
            (id, name, sections_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             sections_json = excluded.sections_json,
             updated_at = excluded.updated_at`,
        )
        .run(
          template.id,
          template.name,
          JSON.stringify(template.sections),
          template.createdAt,
          template.updatedAt,
        )
      const saved = this.requireById(template.id)
      this.database.exec('COMMIT')
      return saved
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  findById(id: string): SummaryTemplate | null {
    const row = this.database
      .prepare('SELECT * FROM summary_templates WHERE id = ?')
      .get(id) as TemplateRow | undefined
    return row === undefined ? null : toTemplate(row)
  }

  requireById(id: string): SummaryTemplate {
    const template = this.findById(id)
    if (template === null) {
      throw new Error(`Summary template ${id} was not found`)
    }
    return template
  }

  list(): SummaryTemplate[] {
    const rows = this.database
      .prepare("SELECT * FROM summary_templates ORDER BY CASE WHEN id = 'default' THEN 0 ELSE 1 END, created_at, id")
      .all() as TemplateRow[]
    return rows.map(toTemplate)
  }

  countMeetingReferences(id: string): number {
    const row = this.database
      .prepare('SELECT COUNT(*) AS count FROM meetings WHERE selected_template_id = ?')
      .get(id) as { count: number }
    return row.count
  }

  delete(id: string): boolean {
    return this.database.prepare('DELETE FROM summary_templates WHERE id = ?').run(id).changes > 0
  }
}
