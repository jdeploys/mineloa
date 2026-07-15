import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { MAX_ARCHIVE_BYTES, parseArchive } from '../../src/main/archive/archiveSchema'

const valid = {
  'manifest.json': strToU8(JSON.stringify({ format: 'nnote', version: 1, entries: ['meeting.json', 'transcript.json', 'summary.json'] })),
  'meeting.json': strToU8(JSON.stringify({ title: '회의', createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z', durationMs: 1, status: 'completed', audioPolicy: 'keep', template: null })),
  'transcript.json': strToU8(JSON.stringify({ speakers: [], segments: [] })),
  'summary.json': strToU8(JSON.stringify({ sections: [], actionItems: [] })),
}

const minimalWebm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x87, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d, 0x18, 0x53, 0x80, 0x67, 0xff])
const semanticSectionId = '10000000-0000-4000-8000-000000000010'
function semanticArchive(overrides: { speakers?: unknown[]; segments?: unknown[]; sections?: unknown[]; actionItems?: unknown[] } = {}) {
  const meeting = { title: '회의', createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z', durationMs: 1, status: 'completed', audioPolicy: 'keep', template: { sourceId: 't', name: 't', sections: [{ id: semanticSectionId, title: '할 일', kind: 'action_items', prompt: 'x' }] } }
  const speakers = overrides.speakers ?? [{ id: 'speaker', displayName: '화자' }]
  const segments = overrides.segments ?? [{ id: 'segment', speakerId: 'speaker', startMs: 0, endMs: 1, text: 'x' }]
  const sections = overrides.sections ?? [{ id: 'section', templateSectionId: semanticSectionId, kind: 'action_items', text: '', items: [], orderIndex: 0 }]
  const actionItems = overrides.actionItems ?? [{ id: 'action', content: 'x', assigneeSpeakerId: 'speaker', dueAt: null, completed: false }]
  return { ...valid, 'meeting.json': strToU8(JSON.stringify(meeting)), 'transcript.json': strToU8(JSON.stringify({ speakers, segments })), 'summary.json': strToU8(JSON.stringify({ sections, actionItems })) }
}

describe('Nnote archive validation', () => {
  it('accepts the exact v1 semantic entry set', () => {
    expect(parseArchive(zipSync(valid)).meeting.title).toBe('회의')
  })

  it('rejects archive v2 audio parts with a decreasing ordered duration cursor', () => {
    const entries = {
      ...valid,
      'audio/part-0.webm': minimalWebm,
      'audio/part-1.webm': minimalWebm,
      'manifest.json': strToU8(JSON.stringify({
        format: 'nnote', version: 2,
        entries: ['meeting.json', 'transcript.json', 'summary.json', 'audio/part-0.webm', 'audio/part-1.webm'],
        audioParts: [
          { partIndex: 0, entry: 'audio/part-0.webm', byteCount: minimalWebm.byteLength, durationMs: 2 },
          { partIndex: 1, entry: 'audio/part-1.webm', byteCount: minimalWebm.byteLength, durationMs: 1 },
        ],
      })),
    }
    expect(() => parseArchive(zipSync(entries))).toThrow(/duration|ordered/i)
  })

  it.each([
    ['traversal', { ...valid, '../meeting.json': strToU8('{}') }],
    ['absolute path', { ...valid, 'C:\\audio.webm': new Uint8Array() }],
    ['UNC path', { ...valid, '\\\\server\\audio.webm': new Uint8Array() }],
    ['Unicode separator', { ...valid, ['folder\u2215audio.webm']: new Uint8Array() }],
    ['extra audio', { ...valid, 'audio.webm': minimalWebm, 'AUDIO.WEBM': minimalWebm }],
  ])('rejects %s entries', (_name, entries) => {
    expect(() => parseArchive(zipSync(entries))).toThrow(/entry|archive|path/i)
  })

  it('rejects unsupported versions and malformed JSON', () => {
    const unsupported = { ...valid, 'manifest.json': strToU8(JSON.stringify({ format: 'nnote', version: 3, entries: [] })) }
    expect(() => parseArchive(zipSync(unsupported))).toThrow(/version/i)
    const malformed = { ...valid, 'meeting.json': strToU8('{') }
    expect(() => parseArchive(zipSync(malformed))).toThrow(/json/i)
  })

  it('rejects a declared entry larger than 100MB before decompression', () => {
    const archive = zipSync(valid)
    const dv = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
    for (let offset = 0; offset + 46 < archive.byteLength; offset++) {
      if (dv.getUint32(offset, true) === 0x02014b50) {
        dv.setUint32(offset + 24, MAX_ARCHIVE_BYTES + 1, true)
        break
      }
    }
    expect(() => parseArchive(archive)).toThrow(/100MB/i)
  })

  it('rejects excessive compression ratio before decompression', () => {
    const entries = { ...valid, 'summary.json': new Uint8Array(1024 * 1024) }
    expect(() => parseArchive(zipSync(entries, { level: 9 }))).toThrow(/compression ratio/i)
  })

  it.each([
    ['truncated magic', new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])],
    ['generic EBML', new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x8b, 0x42, 0x82, 0x88, ...new TextEncoder().encode('matroska'), 0x18, 0x53, 0x80, 0x67, 0xff])],
    ['missing segment', new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x87, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d])],
  ])('rejects non-WebM audio: %s', (_label, audio) => {
    const entries = { ...valid, 'manifest.json': strToU8(JSON.stringify({ format: 'nnote', version: 1, entries: ['meeting.json', 'transcript.json', 'summary.json', 'audio.webm'] })), 'audio.webm': audio }
    expect(() => parseArchive(zipSync(entries))).toThrow(/webm/i)
  })

  it('accepts a bounded WebM EBML header with DocType and Segment', () => {
    const entries = { ...valid, 'manifest.json': strToU8(JSON.stringify({ format: 'nnote', version: 1, entries: ['meeting.json', 'transcript.json', 'summary.json', 'audio.webm'] })), 'audio.webm': minimalWebm }
    expect(parseArchive(zipSync(entries)).audio).toEqual(minimalWebm)
  })

  it.each([
    ['duplicate template section IDs', { templateSections: ['same', 'same'], summaryRefs: ['same', 'same'], summaryKinds: ['paragraph', 'paragraph'], orders: [0, 1] }],
    ['duplicate summary IDs', { templateSections: ['one', 'two'], summaryRefs: ['one', 'two'], summaryIds: ['dup', 'dup'], summaryKinds: ['paragraph', 'bullet_list'], orders: [0, 1] }],
    ['kind mismatch', { templateSections: ['one'], summaryRefs: ['one'], summaryKinds: ['bullet_list'], orders: [0] }],
    ['ambiguous order', { templateSections: ['one', 'two'], summaryRefs: ['one', 'two'], summaryKinds: ['paragraph', 'bullet_list'], orders: [0, 0] }],
  ])('rejects cross-file inconsistency: %s', (_label, shape) => {
    const uuid = (name: string) => name === 'same' ? '10000000-0000-4000-8000-000000000001' : name === 'one' ? '10000000-0000-4000-8000-000000000002' : '10000000-0000-4000-8000-000000000003'
    const templateSections = shape.templateSections.map((id, index) => ({ id: uuid(id), title: id, kind: index === 0 ? 'paragraph' : 'bullet_list', prompt: 'x' }))
    const meeting = { title: '회의', createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z', durationMs: 1, status: 'completed', audioPolicy: 'keep', template: { sourceId: 't', name: 't', sections: templateSections } }
    const sections = shape.summaryRefs.map((ref, index) => ({ id: ('summaryIds' in shape ? shape.summaryIds[index] : undefined) ?? `s${index}`, templateSectionId: uuid(ref), kind: shape.summaryKinds[index], text: '', items: [], orderIndex: shape.orders[index] }))
    const entries = { ...valid, 'meeting.json': strToU8(JSON.stringify(meeting)), 'summary.json': strToU8(JSON.stringify({ sections, actionItems: [] })) }
    expect(() => parseArchive(zipSync(entries))).toThrow(/template|summary|section|order|kind/i)
  })

  it.each([
    ['duplicate speakers', semanticArchive({ speakers: [{ id: 'speaker', displayName: 'A' }, { id: 'speaker', displayName: 'B' }] })],
    ['unknown transcript speaker', semanticArchive({ segments: [{ id: 'segment', speakerId: 'missing', startMs: 0, endMs: 1, text: 'x' }] })],
    ['duplicate transcript segments', semanticArchive({ segments: [{ id: 'same', speakerId: 'speaker', startMs: 0, endMs: 1, text: 'x' }, { id: 'same', speakerId: 'speaker', startMs: 1, endMs: 2, text: 'y' }] })],
    ['unknown action speaker', semanticArchive({ actionItems: [{ id: 'action', content: 'x', assigneeSpeakerId: 'missing', dueAt: null, completed: false }] })],
    ['duplicate action items', semanticArchive({ actionItems: [{ id: 'same', content: 'x', assigneeSpeakerId: null, dueAt: null, completed: false }, { id: 'same', content: 'y', assigneeSpeakerId: null, dueAt: null, completed: false }] })],
    ['missing template section result', semanticArchive({ sections: [] })],
  ])('rejects duplicate or dangling semantic objects: %s', (_label, entries) => {
    expect(() => parseArchive(zipSync(entries))).toThrow(/duplicate|unknown|speaker|section|template/i)
  })

  it('rejects action records when the template has no action_items section', () => {
    const entries = semanticArchive()
    entries['meeting.json'] = strToU8(JSON.stringify({
      title: '회의', createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z', durationMs: 1,
      status: 'completed', audioPolicy: 'keep', template: { sourceId: 't', name: 't', sections: [{ id: semanticSectionId, title: '요약', kind: 'paragraph', prompt: 'x' }] },
    }))
    expect(() => parseArchive(zipSync(entries))).toThrow(/action_items/i)
  })
})
