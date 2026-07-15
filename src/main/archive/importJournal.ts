import { open, readdir, rename, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import { completedPartPath, recordingFilePrefix } from '../recording/recordingPaths'

const JournalV1Schema = z.object({ version: z.literal(1), meetingId: z.string().uuid(), state: z.literal('pending_stage') }).strict()
const JournalV2Schema = z.object({
  version: z.literal(2), meetingId: z.string().uuid(), state: z.literal('pending_stage'),
  partCount: z.number().int().min(1).max(128),
}).strict()
const JournalSchema = z.discriminatedUnion('version', [JournalV1Schema, JournalV2Schema])
const JOURNAL_TEMP_NAME = /^[a-f0-9]{64}\.import\.json\.tmp$/

export function importJournalPath(recordingsDirectory: string, meetingId: string): string {
  return join(recordingsDirectory, `${recordingFilePrefix(meetingId)}import.json`)
}
export function importStagedAudioPath(recordingsDirectory: string, meetingId: string, partIndex = 0): string {
  return `${completedPartPath(recordingsDirectory, meetingId, partIndex)}.importing`
}
export function importJournalTemporaryPath(recordingsDirectory: string, meetingId: string): string {
  return `${importJournalPath(recordingsDirectory, meetingId)}.tmp`
}

export async function syncDirectory(directory: string): Promise<void> {
  try {
    const handle = await open(directory, 'r')
    try { await handle.sync() } finally { await handle.close() }
  } catch (error) {
    if (!['EPERM', 'EACCES', 'EISDIR', 'EBADF', 'EINVAL', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
  }
}

export async function writeImportJournal(recordingsDirectory: string, meetingId: string, partCount = 1): Promise<void> {
  if (!Number.isInteger(partCount) || partCount < 1 || partCount > 128) throw new Error('Invalid import part count')
  const path = importJournalPath(recordingsDirectory, meetingId)
  const temporaryPath = importJournalTemporaryPath(recordingsDirectory, meetingId)
  const handle = await open(temporaryPath, 'wx')
  try { await handle.writeFile(JSON.stringify({ version: 2, meetingId, state: 'pending_stage', partCount }), 'utf8'); await handle.sync() }
  finally { await handle.close() }
  await rename(temporaryPath, path)
  await syncDirectory(recordingsDirectory)
}

async function exists(path: string): Promise<boolean> {
  try { const handle = await open(path, 'r'); await handle.close(); return true }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}

export async function reconcileImportJournals(database: Database.Database, recordingsDirectory: string): Promise<void> {
  let names: string[]
  try { names = await readdir(recordingsDirectory) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  const generatedTemps = names.filter((value) => JOURNAL_TEMP_NAME.test(value))
  for (const name of generatedTemps) await rm(join(recordingsDirectory, name), { force: true })
  if (generatedTemps.length > 0) await syncDirectory(recordingsDirectory)
  for (const name of names.filter((value) => value.endsWith('.import.json')).sort()) {
    const journalPath = join(recordingsDirectory, name)
    let journal: z.infer<typeof JournalSchema>
    try {
      const handle = await open(journalPath, 'r')
      try { journal = JournalSchema.parse(JSON.parse(await handle.readFile('utf8'))) } finally { await handle.close() }
      if (basename(importJournalPath(recordingsDirectory, journal.meetingId)) !== name) throw new Error('Journal name mismatch')
    } catch (error) {
      throw new Error('Import recovery journal is corrupt; files were preserved.', { cause: error })
    }
    const partCount = journal.version === 1 ? 1 : journal.partCount
    const staged = Array.from({ length: partCount }, (_, index) => importStagedAudioPath(recordingsDirectory, journal.meetingId, index))
    const final = Array.from({ length: partCount }, (_, index) => completedPartPath(recordingsDirectory, journal.meetingId, index))
    const row = database.prepare('SELECT id, audio_path FROM meetings WHERE id = ?').get(journal.meetingId) as { id: string; audio_path: string | null } | undefined
    if (row === undefined) {
      await Promise.all([...staged, ...final].map((path) => rm(path, { force: true })))
    } else if (row.audio_path !== basename(final[0]!)) {
      throw new Error('Import recovery journal does not match meeting audio; files were preserved.')
    } else {
      const owned = database.prepare('SELECT part_index, relative_path FROM recording_parts WHERE meeting_id = ? ORDER BY part_index').all(journal.meetingId) as Array<{ part_index: number; relative_path: string }>
      if (owned.length !== partCount || owned.some((part, index) => part.part_index !== index || part.relative_path !== basename(final[index]!))) {
        throw new Error('Import recovery journal does not match recording part ownership; files were preserved.')
      }
      for (let index = 0; index < partCount; index++) {
        if (await exists(final[index]!)) await rm(staged[index]!, { force: true })
        else if (await exists(staged[index]!)) await rename(staged[index]!, final[index]!)
        else throw new Error('Imported meeting audio is missing; recovery journal was preserved.')
      }
    }
    await syncDirectory(recordingsDirectory)
    await rm(journalPath, { force: true })
    await syncDirectory(recordingsDirectory)
  }
}
