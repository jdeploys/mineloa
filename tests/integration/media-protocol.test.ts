import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { openDatabase } from '../../src/main/db/database'
import { MeetingRepository } from '../../src/main/db/meetingRepository'
import { createMediaResponse, meetingMediaUrl } from '../../src/main/media/registerMediaProtocol'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'nnote-media-'))
  roots.push(root)
  const recordings = join(root, 'recordings')
  await mkdir(recordings)
  const database = openDatabase(join(root, 'nnote.sqlite'))
  const meetings = new MeetingRepository(database)
  return { root, recordings, database, meetings }
}

async function retainedMeeting(audioPath = 'first.webm') {
  const h = await harness()
  await writeFile(join(h.recordings, audioPath), Uint8Array.from([0, 1, 2, 3, 4, 5]))
  const now = new Date().toISOString()
  h.meetings.create({ id: 'meeting-1', title: '회의', createdAt: now, updatedAt: now, durationMs: 1,
    status: 'completed', audioPolicy: 'keep', audioPath, audioByteCount: 6, selectedTemplateId: null })
  return h
}

function request(url: string, range?: string, method = 'GET'): Request {
  return new Request(url, { method, headers: range === undefined ? undefined : { range } })
}

describe('privileged local meeting audio protocol', () => {
  it('streams every repository-owned part by canonical opaque meeting and part index', async () => {
    const h = await retainedMeeting()
    await writeFile(join(h.recordings, 'second.webm'), Uint8Array.from([9, 9, 9]))
    h.meetings.replaceRecordingParts('meeting-1', [
      { partIndex: 0, relativePath: 'first.webm', byteCount: 6, durationMs: 1 },
      { partIndex: 1, relativePath: 'second.webm', byteCount: 3, durationMs: 1 },
    ])
    const response = await createMediaResponse(request(meetingMediaUrl('meeting-1')), h.meetings, h.recordings)
    expect(response.status).toBe(200)
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0, 1, 2, 3, 4, 5])
    expect(response.headers.get('content-length')).toBe('6')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    const second = await createMediaResponse(request(meetingMediaUrl('meeting-1', 1)), h.meetings, h.recordings)
    expect([...new Uint8Array(await second.arrayBuffer())]).toEqual([9, 9, 9])
    expect((await createMediaResponse(request(meetingMediaUrl('meeting-1', 2)), h.meetings, h.recordings)).status).toBe(404)
    h.database.close()
  })

  it('serves valid byte ranges and rejects unsatisfiable ranges', async () => {
    const h = await retainedMeeting()
    const partial = await createMediaResponse(request(meetingMediaUrl('meeting-1'), 'bytes=2-4'), h.meetings, h.recordings)
    expect(partial.status).toBe(206)
    expect(partial.headers.get('content-range')).toBe('bytes 2-4/6')
    expect([...new Uint8Array(await partial.arrayBuffer())]).toEqual([2, 3, 4])
    const invalid = await createMediaResponse(request(meetingMediaUrl('meeting-1'), 'bytes=99-'), h.meetings, h.recordings)
    expect(invalid.status).toBe(416)
    expect(invalid.headers.get('content-range')).toBe('bytes */6')
    h.database.close()
  })

  it('supports suffix and open-ended ranges and rejects malformed or multiple ranges', async () => {
    const h = await retainedMeeting()
    const url = meetingMediaUrl('meeting-1')
    const suffix = await createMediaResponse(request(url, 'bytes=-2'), h.meetings, h.recordings)
    expect(suffix.status).toBe(206)
    expect([...new Uint8Array(await suffix.arrayBuffer())]).toEqual([4, 5])
    const openEnded = await createMediaResponse(request(url, 'bytes=3-'), h.meetings, h.recordings)
    expect(openEnded.headers.get('content-range')).toBe('bytes 3-5/6')
    expect([...new Uint8Array(await openEnded.arrayBuffer())]).toEqual([3, 4, 5])
    for (const range of ['items=0-1', 'bytes=-', 'bytes=0-1,3-4', 'bytes=4-2']) {
      expect((await createMediaResponse(request(url, range), h.meetings, h.recordings)).status).toBe(416)
    }
    h.database.close()
  })

  it('answers HEAD with playback headers and no body', async () => {
    const h = await retainedMeeting()
    const response = await createMediaResponse(request(meetingMediaUrl('meeting-1'), undefined, 'HEAD'), h.meetings, h.recordings)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe('6')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.body).toBeNull()
    h.database.close()
  })

  it.each([
    'nnote-media://meeting/../settings',
    'nnote-media://meeting/%2e%2e',
    'nnote-media://meeting/%2Fetc',
    'nnote-media://meeting/C:%5Csecret',
    'nnote-media://meeting/meeting-1?path=secret',
    'nnote-media://other/bWVldGluZy0x',
    'nnote-media://meeting/bWVldGluZy0x=',
  ])('rejects malformed or path-like URL %s', async (url) => {
    const h = await retainedMeeting()
    const response = await createMediaResponse(request(url), h.meetings, h.recordings)
    expect(response.status).toBe(404)
    h.database.close()
  })

  it('rejects userinfo at the real Request construction boundary', () => {
    expect(() => new Request('nnote-media://user@meeting/bWVldGluZy0x')).toThrow(/credentials/i)
  })

  it('authorizes only a canonical opaque token that resolves to an existing repository meeting', async () => {
    const h = await retainedMeeting()
    expect((await createMediaResponse(request(meetingMediaUrl('unknown')), h.meetings, h.recordings)).status).toBe(404)
    const canonical = await createMediaResponse(request(meetingMediaUrl('meeting-1')), h.meetings, h.recordings)
    expect(canonical.status).toBe(200)
    await canonical.body?.cancel()

    // WHATWG URL normalization erases `../` before the protocol handler. Once normalized,
    // `../<valid-token>` is byte-identical to the canonical URL; repository-selected opaque
    // tokens, not impossible-to-recover URL provenance, are the authorization boundary.
    const normalized = new Request(`nnote-media://meeting/../${meetingMediaUrl('meeting-1').split('/').at(-1)}`)
    expect(normalized.url).toBe(meetingMediaUrl('meeting-1'))
    const normalizedResponse = await createMediaResponse(normalized, h.meetings, h.recordings)
    expect(normalizedResponse.status).toBe(200)
    await normalizedResponse.body?.cancel()
    h.database.close()
  })

  it('returns 404 for deleted, missing, directory, and root-escaping audio', async () => {
    const h = await retainedMeeting()
    const now = new Date().toISOString()
    h.meetings.create({ id: 'deleted', title: '삭제', createdAt: now, updatedAt: now, durationMs: 1,
      status: 'deleted', audioPolicy: 'keep', audioPath: basename(join(h.recordings, 'first.webm')), audioByteCount: 6, selectedTemplateId: null })
    h.meetings.create({ id: 'missing', title: '없음', createdAt: now, updatedAt: now, durationMs: 1,
      status: 'completed', audioPolicy: 'keep', audioPath: 'missing.webm', audioByteCount: 6, selectedTemplateId: null })
    await mkdir(join(h.recordings, 'folder'))
    h.meetings.create({ id: 'directory', title: '폴더', createdAt: now, updatedAt: now, durationMs: 1,
      status: 'completed', audioPolicy: 'keep', audioPath: 'folder', audioByteCount: 6, selectedTemplateId: null })
    h.meetings.create({ id: 'escape', title: '탈출', createdAt: now, updatedAt: now, durationMs: 1,
      status: 'completed', audioPolicy: 'keep', audioPath: '..\\outside.webm', audioByteCount: 6, selectedTemplateId: null })
    for (const id of ['deleted', 'missing', 'directory', 'escape']) {
      expect((await createMediaResponse(request(meetingMediaUrl(id)), h.meetings, h.recordings)).status).toBe(404)
    }
    h.database.close()
  })

  it('rejects a repository path whose final file is a symbolic link', async () => {
    const h = await harness()
    const outside = join(h.root, 'outside.webm')
    await writeFile(outside, Uint8Array.from([1, 2, 3]))
    await symlink(outside, join(h.recordings, 'linked.webm'), 'file')
    const now = new Date().toISOString()
    h.meetings.create({ id: 'linked', title: '링크', createdAt: now, updatedAt: now, durationMs: 1,
      status: 'completed', audioPolicy: 'keep', audioPath: 'linked.webm', audioByteCount: 3, selectedTemplateId: null })
    expect((await createMediaResponse(request(meetingMediaUrl('linked')), h.meetings, h.recordings)).status).toBe(404)
    h.database.close()
  })
})
