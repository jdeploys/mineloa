import { lstat, open, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { FileHandle } from 'node:fs/promises'
import type { MeetingRepository } from '../db/meetingRepository'

interface ProtocolLike {
  handle(scheme: string, handler: (request: Request) => Response | Promise<Response>): void
}

type MeetingAudioRepository = Pick<MeetingRepository, 'findById' | 'listRecordingParts'>

interface ByteRange { start: number; end: number }

function notFound(): Response { return new Response(null, { status: 404 }) }

function parseMeetingPart(rawUrl: string): { meetingId: string; partIndex: number } | null {
  const match = /^nnote-media:\/\/meeting\/([^/?#]+)(?:\/part\/(\d+))?$/.exec(rawUrl)
  if (match === null) return null
  try {
    const token = decodeURIComponent(match[1])
    if (!/^[A-Za-z0-9_-]+$/.test(token)) return null
    const id = Buffer.from(token, 'base64url').toString('utf8')
    const partIndex = match[2] === undefined ? 0 : Number(match[2])
    return Buffer.from(id, 'utf8').toString('base64url') === token && /^[A-Za-z0-9_-]{1,200}$/.test(id) && Number.isSafeInteger(partIndex)
      ? { meetingId: id, partIndex }
      : null
  } catch {
    return null
  }
}

export function meetingMediaUrl(meetingId: string, partIndex = 0): string {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(meetingId)) throw new Error('Meeting id must be opaque')
  if (!Number.isSafeInteger(partIndex) || partIndex < 0) throw new Error('Part index must be non-negative')
  const base = `nnote-media://meeting/${Buffer.from(meetingId, 'utf8').toString('base64url')}`
  return partIndex === 0 ? base : `${base}/part/${partIndex}`
}

function parseRange(value: string | null, size: number): ByteRange | null | 'invalid' {
  if (value === null) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim())
  if (match === null || (match[1] === '' && match[2] === '') || size === 0) return 'invalid'
  if (match[1] === '') {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return 'invalid'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(match[1])
  const requestedEnd = match[2] === '' ? size - 1 : Number(match[2])
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= size || requestedEnd < start) return 'invalid'
  return { start, end: Math.min(requestedEnd, size - 1) }
}

function withinRoot(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate)
  return fromRoot === '' || (!fromRoot.startsWith('..') && !isAbsolute(fromRoot))
}

function fileStream(handle: FileHandle, start: number, end: number): ReadableStream<Uint8Array> {
  let position = start
  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    await handle.close()
  }
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const remaining = end - position + 1
        if (remaining <= 0) {
          await close()
          controller.close()
          return
        }
        const buffer = new Uint8Array(Math.min(64 * 1024, remaining))
        const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, position)
        if (bytesRead === 0) {
          await close()
          controller.close()
          return
        }
        position += bytesRead
        controller.enqueue(buffer.subarray(0, bytesRead))
      } catch (error) {
        await close().catch(() => undefined)
        controller.error(error)
      }
    },
    async cancel() { await close() },
  })
}

export async function createMediaResponse(
  request: Request,
  meetings: MeetingAudioRepository,
  recordingsDirectory: string,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return notFound()
  const selection = parseMeetingPart(request.url)
  if (selection === null) return notFound()
  const meeting = meetings.findById(selection.meetingId)
  if (meeting === null || meeting.status === 'deleted' || meeting.audioPath === null) return notFound()
  const durableParts = meetings.listRecordingParts(selection.meetingId)
  const relativePath = durableParts.length === 0 && selection.partIndex === 0
    ? meeting.audioPath
    : durableParts.find((part) => part.partIndex === selection.partIndex)?.relativePath ?? null
  if (relativePath === null || isAbsolute(relativePath)) return notFound()

  const root = resolve(recordingsDirectory)
  const candidate = resolve(root, relativePath)
  if (!withinRoot(root, candidate)) return notFound()

  let handle: FileHandle | null = null
  try {
    const linkInfo = await lstat(candidate)
    if (linkInfo.isSymbolicLink() || !linkInfo.isFile()) return notFound()
    const [rootReal, candidateReal] = await Promise.all([realpath(root), realpath(candidate)])
    if (!withinRoot(rootReal, candidateReal)) return notFound()
    const info = await stat(candidateReal)
    if (!info.isFile()) return notFound()
    const size = info.size
    const range = parseRange(request.headers.get('range'), size)
    const baseHeaders = new Headers({ 'accept-ranges': 'bytes', 'content-type': 'audio/webm' })
    if (range === 'invalid') {
      baseHeaders.set('content-range', `bytes */${size}`)
      return new Response(null, { status: 416, headers: baseHeaders })
    }

    const selected = range ?? { start: 0, end: Math.max(0, size - 1) }
    const length = size === 0 ? 0 : selected.end - selected.start + 1
    baseHeaders.set('content-length', String(length))
    if (range !== null) baseHeaders.set('content-range', `bytes ${selected.start}-${selected.end}/${size}`)
    if (request.method === 'HEAD' || size === 0) {
      return new Response(null, { status: range === null ? 200 : 206, headers: baseHeaders })
    }
    handle = await open(candidateReal, 'r')
    const body = fileStream(handle, selected.start, selected.end)
    handle = null
    return new Response(body, { status: range === null ? 200 : 206, headers: baseHeaders })
  } catch {
    return notFound()
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

export function registerMediaProtocol(
  protocol: ProtocolLike,
  meetings: MeetingAudioRepository,
  recordingsDirectory: string,
): void {
  protocol.handle('nnote-media', (request) => createMediaResponse(request, meetings, recordingsDirectory))
}
