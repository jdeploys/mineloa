import { randomUUID } from 'node:crypto'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import { basename } from 'node:path'
import type Database from 'better-sqlite3'
import { completedPartPath } from '../recording/recordingPaths'
import { parseArchive } from './archiveSchema'
import { importJournalPath, importJournalTemporaryPath, importStagedAudioPath, syncDirectory, writeImportJournal } from './importJournal'

export { reconcileImportJournals } from './importJournal'

export interface ImportedMeetingResult { meetingId: string; importedAudio: boolean }
export type ImportFaultPhase = 'before-stage-open' | 'during-stage-write' | 'after-stage-fsync' | 'after-database-commit' | 'after-audio-rename'
export interface ImportFaultOptions { interruptAt?: ImportFaultPhase; failAt?: ImportFaultPhase }
class SimulatedImportCrash extends Error { constructor() { super('Simulated crash during Nnote import') } }

function injectFault(options: ImportFaultOptions, phase: ImportFaultPhase): void {
  if (options.interruptAt === phase) throw new SimulatedImportCrash()
  if (options.failAt === phase) throw new Error('Injected failure during Nnote import')
}

export async function importMeetingArchive(bytes: Uint8Array, database: Database.Database, recordingsDirectory: string, fault: ImportFaultOptions = {}): Promise<ImportedMeetingResult> {
  const archive = parseArchive(bytes)
  const meetingId = randomUUID()
  const speakerIds = new Map(archive.transcript.speakers.map((speaker) => [speaker.id, randomUUID()]))
  for (const segment of archive.transcript.segments) {
    if (segment.speakerId !== null && !speakerIds.has(segment.speakerId)) throw new Error('Transcript references an unknown speaker')
  }
  for (const item of archive.summary.actionItems) {
    if (item.assigneeSpeakerId !== null && !speakerIds.has(item.assigneeSpeakerId)) throw new Error('Action item references an unknown speaker')
  }

  let templateId: string | null = null
  const sectionIds = new Map<string, string>()
  if (archive.meeting.template !== null) {
    templateId = randomUUID()
    for (const section of archive.meeting.template.sections) sectionIds.set(section.id, randomUUID())
    for (const section of archive.summary.sections) if (!sectionIds.has(section.templateSectionId)) throw new Error('Summary references an unknown template section')
  } else if (archive.summary.sections.length > 0) {
    throw new Error('Summary sections require an archived template snapshot')
  }

  const finalPaths = archive.audioParts.map((part) => completedPartPath(recordingsDirectory, meetingId, part.partIndex))
  const temporaryPaths = archive.audioParts.map((part) => importStagedAudioPath(recordingsDirectory, meetingId, part.partIndex))
  const journalPath = archive.audioParts.length === 0 ? null : importJournalPath(recordingsDirectory, meetingId)
  const journalTemporaryPath = archive.audioParts.length === 0 ? null : importJournalTemporaryPath(recordingsDirectory, meetingId)
  let databaseCommitted = false
  const finalOwned = new Set<string>()
  try {
    if (archive.audioParts.length > 0) {
      await mkdir(recordingsDirectory, { recursive: true })
      await writeImportJournal(recordingsDirectory, meetingId, archive.audioParts.length)
      injectFault(fault, 'before-stage-open')
      for (const [index, part] of archive.audioParts.entries()) {
        const handle = await open(temporaryPaths[index]!, 'wx')
        try {
          if (index === 0 && (fault.interruptAt === 'during-stage-write' || fault.failAt === 'during-stage-write')) {
            await handle.writeFile(part.bytes.subarray(0, Math.max(1, Math.floor(part.bytes.byteLength / 2))))
            injectFault(fault, 'during-stage-write')
          }
          await handle.writeFile(part.bytes)
          await handle.sync()
        } finally { await handle.close() }
      }
      await syncDirectory(recordingsDirectory)
      injectFault(fault, 'after-stage-fsync')
    }

    database.exec('BEGIN IMMEDIATE')
    try {
      const now = new Date().toISOString()
      if (archive.meeting.template !== null && templateId !== null) {
        const sections = archive.meeting.template.sections.map((section) => ({ ...section, id: sectionIds.get(section.id)! }))
        database.prepare('INSERT INTO summary_templates (id, name, sections_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
          .run(templateId, `${archive.meeting.template.name} (가져옴)`, JSON.stringify(sections), now, now)
      }
      database.prepare(`INSERT INTO meetings (id, title, created_at, updated_at, duration_ms, status, audio_policy, audio_path, audio_byte_count, selected_template_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(meetingId, archive.meeting.title, archive.meeting.createdAt, archive.meeting.updatedAt, archive.meeting.durationMs,
          archive.meeting.status, archive.meeting.audioPolicy, finalPaths.length === 0 ? null : basename(finalPaths[0]!),
          archive.audioParts.reduce((total, part) => total + part.byteCount, 0), templateId)
      const insertPart = database.prepare('INSERT INTO recording_parts (meeting_id, part_index, relative_path, byte_count, duration_ms) VALUES (?, ?, ?, ?, ?)')
      for (const [index, part] of archive.audioParts.entries()) insertPart.run(meetingId, part.partIndex, basename(finalPaths[index]!), part.byteCount, part.durationMs)
      for (const speaker of archive.transcript.speakers) database.prepare('INSERT INTO speakers (id, meeting_id, display_name) VALUES (?, ?, ?)')
        .run(speakerIds.get(speaker.id), meetingId, speaker.displayName)
      for (const segment of archive.transcript.segments) database.prepare('INSERT INTO transcript_segments (id, meeting_id, speaker_id, start_ms, end_ms, text) VALUES (?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), meetingId, segment.speakerId === null ? null : speakerIds.get(segment.speakerId), segment.startMs, segment.endMs, segment.text)
      for (const section of archive.summary.sections) database.prepare('INSERT INTO summary_sections (id, meeting_id, template_section_id, kind, content_json, order_index) VALUES (?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), meetingId, sectionIds.get(section.templateSectionId), section.kind, JSON.stringify({ text: section.text, items: section.items }), section.orderIndex)
      for (const item of archive.summary.actionItems) database.prepare('INSERT INTO action_items (id, meeting_id, content, assignee_speaker_id, due_at, completed) VALUES (?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), meetingId, item.content, item.assigneeSpeakerId === null ? null : speakerIds.get(item.assigneeSpeakerId), item.dueAt, item.completed ? 1 : 0)
      database.exec('COMMIT')
      databaseCommitted = true
    } catch (error) { database.exec('ROLLBACK'); throw error }
    injectFault(fault, 'after-database-commit')
    if (journalPath !== null) {
      for (const [index, temporaryPath] of temporaryPaths.entries()) {
        const finalPath = finalPaths[index]!
        await rename(temporaryPath, finalPath)
        finalOwned.add(finalPath)
      }
      await syncDirectory(recordingsDirectory)
      injectFault(fault, 'after-audio-rename')
      await rm(journalPath, { force: true })
      await syncDirectory(recordingsDirectory)
    }
    return { meetingId, importedAudio: archive.audioParts.length > 0 }
  } catch (error) {
    if (error instanceof SimulatedImportCrash) throw error
    if (databaseCommitted) {
      database.exec('BEGIN IMMEDIATE')
      try {
        database.prepare('DELETE FROM meetings WHERE id = ?').run(meetingId)
        if (templateId !== null) database.prepare('DELETE FROM summary_templates WHERE id = ?').run(templateId)
        database.exec('COMMIT')
      } catch (cleanupError) { database.exec('ROLLBACK'); throw new AggregateError([error, cleanupError], 'Import and rollback failed') }
    }
    await Promise.all(temporaryPaths.map((path) => rm(path, { force: true }).catch(() => undefined)))
    await Promise.all([...finalOwned].map((path) => rm(path, { force: true }).catch(() => undefined)))
    if (journalPath !== null) await rm(journalPath, { force: true }).catch(() => undefined)
    if (journalTemporaryPath !== null) await rm(journalTemporaryPath, { force: true }).catch(() => undefined)
    if (journalPath !== null) await syncDirectory(recordingsDirectory).catch(() => undefined)
    throw error
  }
}
