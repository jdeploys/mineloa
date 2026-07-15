import { open, rename, rm } from 'node:fs/promises'
import type Database from 'better-sqlite3'
import type { MeetingRepository } from '../db/meetingRepository'
import type { TemplateRepository } from '../db/templateRepository'
import { MeetingIdSchema } from '../../shared/contracts/meetingsApi'
import type { ArchiveOperationResult } from '../../shared/contracts/archive'
import { MAX_ARCHIVE_BYTES } from '../archive/archiveSchema'
import { exportMeetingArchive } from '../archive/exportMeeting'
import { importMeetingArchive } from '../archive/importMeeting'
import { exportMarkdown } from '../archive/exportMarkdown'
import { DEFAULT_TEMPLATE_ID } from '../templates/defaultTemplate'

interface IpcMainLike { handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void }
interface DialogLike {
  showSaveDialog(options: { title: string; defaultPath: string; filters: { name: string; extensions: string[] }[] }): Promise<{ canceled: boolean; filePath?: string }>
  showOpenDialog(options: { title: string; properties: ['openFile']; filters: { name: string; extensions: string[] }[] }): Promise<{ canceled: boolean; filePaths: string[] }>
}
interface BoundedReadHandle {
  stat(): Promise<{ size: number; isFile(): boolean }>
  read(buffer: Uint8Array): Promise<{ bytesRead: number }>
  close(): Promise<void>
}
interface BoundedReadFileSystem { open(path: string, flags: 'r'): Promise<BoundedReadHandle> }

type ExportRepository = Pick<MeetingRepository, 'requireById' | 'listSpeakers' | 'listTranscript' | 'listSummarySections' | 'listActionItems' | 'listRecordingParts'>
type TemplateLookup = Pick<TemplateRepository, 'findById'>

async function atomicWrite(destination: string, bytes: Uint8Array | string): Promise<void> {
  const temporary = `${destination}.${process.pid}.tmp`
  const handle = await open(temporary, 'wx')
  try {
    await handle.writeFile(bytes)
    await handle.sync()
    await handle.close()
    await rename(temporary, destination)
  } catch (error) {
    await handle.close().catch(() => undefined)
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function readBoundedArchiveFile(
  path: string,
  fileSystem: BoundedReadFileSystem = { open: (value, flags) => open(value, flags) as unknown as Promise<BoundedReadHandle> },
  maxBytes = MAX_ARCHIVE_BYTES,
): Promise<Uint8Array> {
  const handle = await fileSystem.open(path, 'r')
  try {
    const before = await handle.stat()
    if (!before.isFile()) throw new Error('Archive selection is not a regular file')
    if (!Number.isSafeInteger(before.size) || before.size < 0 || before.size > maxBytes) throw new Error('Archive is too large (100MB maximum)')
    const chunks: Uint8Array[] = []; let total = 0
    while (total <= maxBytes) {
      const buffer = new Uint8Array(Math.min(64 * 1024, maxBytes + 1 - total))
      const { bytesRead } = await handle.read(buffer)
      if (bytesRead === 0) break
      if (!Number.isSafeInteger(bytesRead) || bytesRead < 0 || bytesRead > buffer.byteLength) throw new Error('Archive read failed')
      chunks.push(buffer.slice(0, bytesRead)); total += bytesRead
    }
    if (total > maxBytes) throw new Error('Archive is too large (100MB maximum)')
    const after = await handle.stat()
    if (after.size !== before.size || total !== before.size) throw new Error('Archive changed while it was being read')
    const result = new Uint8Array(total); let offset = 0
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength }
    return result
  } finally { await handle.close() }
}

function failure(code: 'EXPORT_FAILED' | 'IMPORT_FAILED' | 'INVALID_ARCHIVE', error: unknown): ArchiveOperationResult {
  void error
  const message = code === 'EXPORT_FAILED' ? '내보내지 못했습니다.' : '선택한 Nnote 파일을 가져오지 못했습니다.'
  return { status: 'failure', code, message }
}

function assertExportableStatus(status: string): void {
  if (status !== 'recorded' && status !== 'completed') throw new Error('Only stable recorded or completed meetings can be exported')
}

export function registerArchiveHandlers(
  ipcMain: IpcMainLike, dialog: DialogLike, repository: ExportRepository, templates: TemplateLookup,
  database: Database.Database, recordingsDirectory: string,
): void {
  ipcMain.handle('archive:export-meeting', async (_event, rawMeetingId) => {
    try {
      const meetingId = MeetingIdSchema.parse(rawMeetingId)
      const meeting = repository.requireById(meetingId)
      assertExportableStatus(meeting.status)
      const selected = await dialog.showSaveDialog({ title: 'Nnote 내보내기', defaultPath: `${meeting.title}.nnote`, filters: [{ name: 'Nnote', extensions: ['nnote'] }] })
      if (selected.canceled || selected.filePath === undefined) return { status: 'cancelled' }
      const result = await exportMeetingArchive(meetingId, repository, templates, recordingsDirectory)
      await atomicWrite(selected.filePath, result.bytes)
      return { status: 'success', includedAudio: result.includedAudio, audioCoverage: result.audioCoverage }
    } catch (error) { return failure('EXPORT_FAILED', error) }
  })

  ipcMain.handle('archive:export-markdown', async (_event, rawMeetingId) => {
    try {
      const meetingId = MeetingIdSchema.parse(rawMeetingId)
      const meeting = repository.requireById(meetingId)
      assertExportableStatus(meeting.status)
      const selected = await dialog.showSaveDialog({ title: 'Markdown 내보내기', defaultPath: `${meeting.title}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] })
      if (selected.canceled || selected.filePath === undefined) return { status: 'cancelled' }
      const template = templates.findById(meeting.selectedTemplateId ?? DEFAULT_TEMPLATE_ID)
      const titles = new Map(template?.sections.map((section) => [section.id, section.title]) ?? [])
      const markdown = exportMarkdown({
        meeting, speakers: repository.listSpeakers(meetingId), transcript: repository.listTranscript(meetingId),
        summarySections: repository.listSummarySections(meetingId).map((section) => ({ ...section, title: titles.get(section.templateSectionId) ?? '요약 섹션' })),
        actionItems: repository.listActionItems(meetingId),
      })
      await atomicWrite(selected.filePath, markdown)
      return { status: 'success' }
    } catch (error) { return failure('EXPORT_FAILED', error) }
  })

  ipcMain.handle('archive:import-meeting', async () => {
    try {
      const selected = await dialog.showOpenDialog({ title: 'Nnote 가져오기', properties: ['openFile'], filters: [{ name: 'Nnote', extensions: ['nnote'] }] })
      if (selected.canceled || selected.filePaths.length !== 1) return { status: 'cancelled' }
      const result = await importMeetingArchive(await readBoundedArchiveFile(selected.filePaths[0]), database, recordingsDirectory)
      return { status: 'success', meetingId: result.meetingId, includedAudio: result.importedAudio }
    } catch (error) { return failure('INVALID_ARCHIVE', error) }
  })
}
