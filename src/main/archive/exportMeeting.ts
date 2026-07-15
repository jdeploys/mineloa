import { lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import type { MeetingRepository } from '../db/meetingRepository'
import type { TemplateRepository } from '../db/templateRepository'
import type { SummaryTemplate } from '../../shared/contracts/template'
import { DEFAULT_TEMPLATE_ID } from '../templates/defaultTemplate'
import { parseArchive } from './archiveSchema'

type ExportRepository = Pick<MeetingRepository, 'requireById' | 'listSpeakers' | 'listTranscript' | 'listSummarySections' | 'listActionItems' | 'listRecordingParts'>
type TemplateLookup = Pick<TemplateRepository, 'findById'>

function isWithin(root: string, candidate: string): boolean {
  const part = relative(root, candidate)
  return part === '' || (!part.startsWith('..') && !isAbsolute(part))
}

async function readRetainedAudio(rootDirectory: string, relativePath: string): Promise<Uint8Array> {
  if (isAbsolute(relativePath)) throw new Error('Retained audio path must be relative')
  const root = resolve(rootDirectory)
  const candidate = resolve(root, relativePath)
  if (!isWithin(root, candidate)) throw new Error('Retained audio path escapes recordings directory')
  const info = await lstat(candidate)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Retained audio must be a regular file')
  const [rootReal, candidateReal] = await Promise.all([realpath(root), realpath(candidate)])
  if (!isWithin(rootReal, candidateReal)) throw new Error('Retained audio resolves outside recordings directory')
  return readFile(candidateReal)
}

function templateSnapshot(template: SummaryTemplate | null) {
  return template === null ? null : { sourceId: template.id, name: template.name, sections: template.sections }
}

export async function exportMeetingArchive(
  meetingId: string,
  repository: ExportRepository,
  templates: TemplateLookup,
  recordingsDirectory: string,
): Promise<{ bytes: Uint8Array; includedAudio: boolean; audioCoverage: 'none' | 'all-parts' }> {
  const meeting = repository.requireById(meetingId)
  if (meeting.status !== 'recorded' && meeting.status !== 'completed') throw new Error('Only stable recorded or completed meetings can be exported')
  const ownedParts = meeting.audioPath === null ? [] : repository.listRecordingParts(meetingId)
  const partMetadata = ownedParts.length > 0
    ? ownedParts
    : meeting.audioPath === null ? [] : [{ meetingId, partIndex: 0, relativePath: meeting.audioPath, byteCount: meeting.audioByteCount, durationMs: meeting.durationMs }]
  const audioParts = await Promise.all(partMetadata.map(async (part, index) => {
    if (part.partIndex !== index) throw new Error('Recording part ownership is not contiguous')
    const bytes = await readRetainedAudio(recordingsDirectory, part.relativePath)
    if (bytes.byteLength !== part.byteCount) throw new Error('Recording part size does not match its ownership metadata')
    return { ...part, bytes, entry: `audio/part-${index}.webm` }
  }))
  const summarySections = repository.listSummarySections(meetingId)
  const existingTemplate = templates.findById(meeting.selectedTemplateId ?? DEFAULT_TEMPLATE_ID)
  const template = existingTemplate ?? (summarySections.length === 0 ? null : {
    id: 'embedded-summary-template', name: '가져온 요약', isDefault: false,
    sections: summarySections.map((section) => ({ id: section.templateSectionId, title: '요약 섹션', kind: section.kind, prompt: '가져온 요약 섹션' })),
    createdAt: meeting.createdAt, updatedAt: meeting.updatedAt,
  })
  const payloadNames = ['meeting.json', 'transcript.json', 'summary.json', ...audioParts.map(({ entry }) => entry)]
  const manifest = {
    format: 'nnote', version: 2, entries: payloadNames,
    audioParts: audioParts.map(({ partIndex, entry, byteCount, durationMs }) => ({ partIndex, entry, byteCount, durationMs })),
  }
  const entries: Record<string, Uint8Array> = {
    'manifest.json': strToU8(JSON.stringify(manifest)),
    'meeting.json': strToU8(JSON.stringify({
      title: meeting.title, createdAt: meeting.createdAt, updatedAt: meeting.updatedAt,
      durationMs: meeting.durationMs, status: meeting.status, audioPolicy: meeting.audioPolicy,
      template: templateSnapshot(template),
    })),
    'transcript.json': strToU8(JSON.stringify({
      speakers: repository.listSpeakers(meetingId).map(({ id, displayName }) => ({ id, displayName })),
      segments: repository.listTranscript(meetingId).map(({ id, speakerId, startMs, endMs, text }) => ({ id, speakerId, startMs, endMs, text })),
    })),
    'summary.json': strToU8(JSON.stringify({
      sections: summarySections.map(({ id, templateSectionId, kind, text, items, orderIndex }) => ({ id, templateSectionId, kind, text, items, orderIndex })),
      actionItems: repository.listActionItems(meetingId).map(({ id, content, assigneeSpeakerId, dueAt, completed }) => ({ id, content, assigneeSpeakerId, dueAt, completed })),
    })),
  }
  for (const part of audioParts) entries[part.entry] = part.bytes
  const bytes = zipSync(entries, { level: 0 })
  parseArchive(bytes)
  return { bytes, includedAudio: audioParts.length > 0, audioCoverage: audioParts.length === 0 ? 'none' : 'all-parts' }
}
