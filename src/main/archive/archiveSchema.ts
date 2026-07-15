import { strFromU8, unzipSync } from 'fflate'
import { z } from 'zod'
import { AudioPolicySchema } from '../../shared/contracts/meeting'
import { SummaryTemplateSectionsSchema } from '../../shared/contracts/template'

export const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024
export const MAX_AUDIO_PARTS = 128
export const MAX_ARCHIVE_ENTRIES = 4 + MAX_AUDIO_PARTS
export const MAX_COMPRESSION_RATIO = 100
export const ARCHIVE_ENTRIES = ['manifest.json', 'meeting.json', 'transcript.json', 'summary.json', 'audio.webm'] as const
const required = ARCHIVE_ENTRIES.slice(0, 4)
const AUDIO_PART_ENTRY = /^audio\/part-(0|[1-9]\d*)\.webm$/

export const ArchiveTemplateSchema = z.object({
  sourceId: z.string().min(1), name: z.string().min(1).max(200),
  sections: SummaryTemplateSectionsSchema,
}).strict()
export const ArchiveMeetingSchema = z.object({
  title: z.string(), createdAt: z.string().datetime({ offset: true }), updatedAt: z.string().datetime({ offset: true }),
  durationMs: z.number().int().nonnegative(), status: z.enum(['recorded', 'completed']),
  audioPolicy: AudioPolicySchema, template: ArchiveTemplateSchema.nullable(),
}).strict()
export const ArchiveTranscriptSchema = z.object({
  speakers: z.array(z.object({ id: z.string().min(1), displayName: z.string().min(1) }).strict()),
  segments: z.array(z.object({ id: z.string().min(1), speakerId: z.string().min(1).nullable(), startMs: z.number().int().nonnegative(), endMs: z.number().int().nonnegative(), text: z.string() }).strict().refine((v) => v.endMs >= v.startMs)),
}).strict()
export const ArchiveSummarySchema = z.object({
  sections: z.array(z.object({ id: z.string().min(1), templateSectionId: z.string().uuid(), kind: z.enum(['paragraph', 'bullet_list', 'action_items']), text: z.string(), items: z.array(z.string()), orderIndex: z.number().int().nonnegative() }).strict()),
  actionItems: z.array(z.object({ id: z.string().min(1), content: z.string().min(1), assigneeSpeakerId: z.string().min(1).nullable(), dueAt: z.string().nullable(), completed: z.boolean() }).strict()),
}).strict()
export const ArchiveManifestV1Schema = z.object({
  format: z.literal('nnote'), version: z.literal(1),
  entries: z.array(z.enum(ARCHIVE_ENTRIES)).min(3).max(4),
}).strict()
export const ArchiveManifestV2Schema = z.object({
  format: z.literal('nnote'), version: z.literal(2),
  entries: z.array(z.string().min(1)).min(3).max(3 + MAX_AUDIO_PARTS),
  audioParts: z.array(z.object({
    partIndex: z.number().int().nonnegative(),
    entry: z.string().regex(AUDIO_PART_ENTRY),
    byteCount: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
  }).strict()).max(MAX_AUDIO_PARTS),
}).strict()
export const ArchiveManifestSchema = z.discriminatedUnion('version', [ArchiveManifestV1Schema, ArchiveManifestV2Schema])

export type ParsedArchive = {
  manifest: z.infer<typeof ArchiveManifestSchema>
  meeting: z.infer<typeof ArchiveMeetingSchema>
  transcript: z.infer<typeof ArchiveTranscriptSchema>
  summary: z.infer<typeof ArchiveSummarySchema>
  audio: Uint8Array | null
  audioParts: Array<{ partIndex: number; entry: string; byteCount: number; durationMs: number; bytes: Uint8Array }>
}

type CentralEntry = { name: string; compressedSize: number; uncompressedSize: number; crc: number; externalAttributes: number; madeBy: number; flags: number }
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

function centralEntries(bytes: Uint8Array): CentralEntry[] {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new Error('Archive exceeds 100MB')
  const dv = view(bytes)
  const start = Math.max(0, bytes.byteLength - 65_557)
  let eocd = -1
  for (let offset = bytes.byteLength - 22; offset >= start; offset--) {
    if (dv.getUint32(offset, true) === 0x06054b50) { eocd = offset; break }
  }
  if (eocd < 0) throw new Error('Invalid ZIP archive')
  const count = dv.getUint16(eocd + 10, true)
  const centralSize = dv.getUint32(eocd + 12, true)
  let offset = dv.getUint32(eocd + 16, true)
  if (count > MAX_ARCHIVE_ENTRIES) throw new Error('Archive has too many entries')
  if (offset + centralSize > eocd) throw new Error('Invalid ZIP central directory')
  const result: CentralEntry[] = []
  for (let index = 0; index < count; index++) {
    if (offset + 46 > bytes.byteLength || dv.getUint32(offset, true) !== 0x02014b50) throw new Error('Invalid ZIP entry')
    const madeBy = dv.getUint16(offset + 4, true)
    const nameLength = dv.getUint16(offset + 28, true)
    const extraLength = dv.getUint16(offset + 30, true)
    const commentLength = dv.getUint16(offset + 32, true)
    const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    result.push({ name, compressedSize: dv.getUint32(offset + 20, true), uncompressedSize: dv.getUint32(offset + 24, true), crc: dv.getUint32(offset + 16, true), externalAttributes: dv.getUint32(offset + 38, true), madeBy, flags: dv.getUint16(offset + 8, true) })
    offset += 46 + nameLength + extraLength + commentLength
  }
  if (offset !== dv.getUint32(eocd + 16, true) + centralSize) throw new Error('Invalid ZIP central directory size')
  return result
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function parseJson<T>(name: string, bytes: Uint8Array, schema: z.ZodType<T>): T {
  try { return schema.parse(JSON.parse(strFromU8(bytes))) }
  catch (error) { throw new Error(`Invalid ${name} JSON`, { cause: error }) }
}

function vint(bytes: Uint8Array, offset: number): { length: number; value: number; unknown: boolean } | null {
  if (offset >= bytes.length) return null
  const first = bytes[offset]!
  let mask = 0x80; let length = 1
  while (length <= 8 && (first & mask) === 0) { mask >>>= 1; length++ }
  if (length > 8 || offset + length > bytes.length) return null
  let value = first & (mask - 1)
  let unknown = value === mask - 1
  for (let index = 1; index < length; index++) {
    value = value * 256 + bytes[offset + index]!
    unknown = unknown && bytes[offset + index] === 0xff
  }
  return { length, value, unknown }
}

function isWebm(bytes: Uint8Array): boolean {
  if (bytes.length < 17 || ![0x1a, 0x45, 0xdf, 0xa3].every((value, index) => bytes[index] === value)) return false
  const headerSize = vint(bytes, 4)
  if (headerSize === null || headerSize.unknown) return false
  const headerStart = 4 + headerSize.length
  const headerEnd = headerStart + headerSize.value
  if (headerEnd > bytes.length || headerSize.value > 16 * 1024) return false
  let offset = headerStart; let documentType: string | null = null
  while (offset < headerEnd) {
    const first = bytes[offset]!
    let idLength = 1; let mask = 0x80
    while (idLength <= 4 && (first & mask) === 0) { mask >>>= 1; idLength++ }
    if (idLength > 4 || offset + idLength > headerEnd) return false
    const id = bytes.subarray(offset, offset + idLength); offset += idLength
    const size = vint(bytes, offset)
    if (size === null || size.unknown) return false
    offset += size.length
    if (offset + size.value > headerEnd) return false
    if (idLength === 2 && id[0] === 0x42 && id[1] === 0x82) documentType = new TextDecoder().decode(bytes.subarray(offset, offset + size.value))
    offset += size.value
  }
  if (offset !== headerEnd || documentType !== 'webm') return false
  if (headerEnd + 5 > bytes.length || ![0x18, 0x53, 0x80, 0x67].every((value, index) => bytes[headerEnd + index] === value)) return false
  const segmentSize = vint(bytes, headerEnd + 4)
  if (segmentSize === null) return false
  const payloadStart = headerEnd + 4 + segmentSize.length
  return segmentSize.unknown || payloadStart + segmentSize.value <= bytes.length
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`)
}

function validateSemantics(archive: Omit<ParsedArchive, 'audio' | 'manifest'>): void {
  assertUnique(archive.transcript.speakers.map(({ id }) => id), 'speaker IDs')
  assertUnique(archive.transcript.segments.map(({ id }) => id), 'transcript segment IDs')
  assertUnique(archive.summary.sections.map(({ id }) => id), 'summary section IDs')
  assertUnique(archive.summary.actionItems.map(({ id }) => id), 'action item IDs')
  const speakers = new Set(archive.transcript.speakers.map(({ id }) => id))
  for (const segment of archive.transcript.segments) if (segment.speakerId !== null && !speakers.has(segment.speakerId)) throw new Error('Transcript references an unknown speaker')
  for (const item of archive.summary.actionItems) if (item.assigneeSpeakerId !== null && !speakers.has(item.assigneeSpeakerId)) throw new Error('Action item references an unknown speaker')
  const template = archive.meeting.template
  if (template === null) {
    if (archive.summary.sections.length > 0 || archive.summary.actionItems.length > 0) throw new Error('Summary requires a template snapshot')
    return
  }
  assertUnique(template.sections.map(({ id }) => id), 'template section IDs')
  const actionDefinitions = template.sections.filter(({ kind }) => kind === 'action_items')
  if (actionDefinitions.length > 1) throw new Error('Template has ambiguous action item sections')
  if (archive.summary.actionItems.length > 0 && actionDefinitions.length !== 1) throw new Error('Action items require an action_items template section')
  if (archive.summary.sections.length === 0 && archive.summary.actionItems.length === 0) return
  if (archive.summary.sections.length !== template.sections.length) throw new Error('Every template section requires exactly one summary section')
  const byReference = new Map(archive.summary.sections.map((section) => [section.templateSectionId, section]))
  if (byReference.size !== archive.summary.sections.length) throw new Error('Duplicate summary template section reference')
  for (const [orderIndex, definition] of template.sections.entries()) {
    const section = byReference.get(definition.id)
    if (section === undefined) throw new Error('Summary references an unknown or missing template section')
    if (section.kind !== definition.kind) throw new Error('Summary section kind does not match template')
    if (section.orderIndex !== orderIndex) throw new Error('Summary section order is ambiguous')
  }
}

export function parseArchive(bytes: Uint8Array): ParsedArchive {
  const central = centralEntries(bytes)
  let total = 0; let compressedTotal = 0
  const names = new Set<string>()
  for (const entry of central) {
    total += entry.uncompressedSize
    compressedTotal += entry.compressedSize
    if (entry.compressedSize > MAX_ARCHIVE_BYTES || entry.uncompressedSize > MAX_ARCHIVE_BYTES || total > MAX_ARCHIVE_BYTES) throw new Error('Archive entry exceeds 100MB')
    if ((entry.compressedSize === 0 && entry.uncompressedSize > 0) || (entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > MAX_COMPRESSION_RATIO)) throw new Error('Archive entry compression ratio exceeds 100:1')
    if (!ARCHIVE_ENTRIES.includes(entry.name as typeof ARCHIVE_ENTRIES[number]) && !AUDIO_PART_ENTRY.test(entry.name)) throw new Error(`Archive entry path is not allowed: ${entry.name}`)
    const normalized = entry.name.normalize('NFKC').toLocaleLowerCase('en-US')
    if (names.has(normalized)) throw new Error('Archive contains duplicate entry names')
    names.add(normalized)
    const host = entry.madeBy >>> 8
    const unixMode = entry.externalAttributes >>> 16
    if ((entry.flags & 1) !== 0) throw new Error('Encrypted archive entries are not allowed')
    if (host === 3 && (unixMode & 0xf000) === 0xa000) throw new Error('Archive symlink entries are not allowed')
  }
  if ((compressedTotal === 0 && total > 0) || (compressedTotal > 0 && total / compressedTotal > MAX_COMPRESSION_RATIO)) throw new Error('Archive aggregate compression ratio exceeds 100:1')
  for (const name of required) if (!names.has(name)) throw new Error(`Archive entry is missing: ${name}`)
  let files: Record<string, Uint8Array>
  try { files = unzipSync(bytes) } catch (error) { throw new Error('Archive decompression failed', { cause: error }) }
  for (const entry of central) {
    const data = files[entry.name]
    if (data === undefined || data.byteLength !== entry.uncompressedSize || crc32(data) !== entry.crc) throw new Error('Archive CRC or size validation failed')
  }
  let rawManifest: unknown
  try { rawManifest = JSON.parse(strFromU8(files['manifest.json'])) } catch (error) { throw new Error('Invalid manifest.json JSON', { cause: error }) }
  if (typeof rawManifest === 'object' && rawManifest !== null && 'version' in rawManifest && rawManifest.version !== 1 && rawManifest.version !== 2) throw new Error('Unsupported archive version')
  let manifest: z.infer<typeof ArchiveManifestSchema>
  try { manifest = ArchiveManifestSchema.parse(rawManifest) }
  catch (error) { throw new Error('Invalid archive manifest', { cause: error }) }
  const actualPayload = central.map((e) => e.name).filter((n) => n !== 'manifest.json').sort()
  if (JSON.stringify([...manifest.entries].sort()) !== JSON.stringify(actualPayload)) throw new Error('Archive manifest entries do not match ZIP entries')
  const meeting = parseJson('meeting.json', files['meeting.json'], ArchiveMeetingSchema)
  if (manifest.version === 2 && files['audio.webm'] !== undefined) throw new Error('Archive v2 audio must be declared in audioParts')
  const audioParts = manifest.version === 1
    ? (files['audio.webm'] === undefined ? [] : [{ partIndex: 0, entry: 'audio.webm', byteCount: files['audio.webm'].byteLength, durationMs: meeting.durationMs, bytes: files['audio.webm'] }])
    : manifest.audioParts.map((part, index) => {
      if (part.partIndex !== index || part.entry !== `audio/part-${index}.webm`) throw new Error('Archive audio parts must be contiguous and canonically named')
      if (part.durationMs > meeting.durationMs || (index > 0 && part.durationMs < manifest.audioParts[index - 1]!.durationMs)) {
        throw new Error('Archive audio part duration cursors are not ordered')
      }
      const bytes = files[part.entry]
      if (bytes === undefined || bytes.byteLength !== part.byteCount) throw new Error('Archive audio part size does not match its manifest')
      return { ...part, bytes }
    })
  if (manifest.version === 2) {
    const audioEntries = actualPayload.filter((entry) => AUDIO_PART_ENTRY.test(entry))
    if (audioEntries.length !== audioParts.length) throw new Error('Archive audio part manifest does not match ZIP entries')
  }
  for (const part of audioParts) if (!isWebm(part.bytes)) throw new Error('Archive audio is not a structurally valid WebM')
  const audio = audioParts[0]?.bytes ?? null
  const parsed = {
    manifest,
    meeting,
    transcript: parseJson('transcript.json', files['transcript.json'], ArchiveTranscriptSchema),
    summary: parseJson('summary.json', files['summary.json'], ArchiveSummarySchema),
    audio,
    audioParts,
  }
  validateSemantics(parsed)
  return parsed
}
