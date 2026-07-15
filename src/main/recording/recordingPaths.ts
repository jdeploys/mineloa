import { createHash } from 'node:crypto'
import { join } from 'node:path'

function safeMeetingName(meetingId: string): string {
  if (meetingId.length === 0) {
    throw new Error('Meeting id must not be empty')
  }
  return createHash('sha256').update(meetingId, 'utf8').digest('hex')
}

export function manifestPath(recordingsDirectory: string, meetingId: string): string {
  return join(recordingsDirectory, `${safeMeetingName(meetingId)}.session.json`)
}

export function temporaryManifestPath(recordingsDirectory: string, meetingId: string): string {
  return `${manifestPath(recordingsDirectory, meetingId)}.tmp`
}

export function pendingPartPath(
  recordingsDirectory: string,
  meetingId: string,
  partIndex: number,
): string {
  return join(recordingsDirectory, `${safeMeetingName(meetingId)}.part-${partIndex}.webm.part`)
}

export function completedPartPath(
  recordingsDirectory: string,
  meetingId: string,
  partIndex: number,
): string {
  return join(recordingsDirectory, `${safeMeetingName(meetingId)}.part-${partIndex}.webm`)
}

export function recordingFilePrefix(meetingId: string): string {
  return `${safeMeetingName(meetingId)}.`
}
