import { mkdir, open, readFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { manifestPath, temporaryManifestPath } from './recordingPaths'

export interface RecordingPartManifest {
  partIndex: number
  lastChunkIndex: number
  byteCount: number
  durationMs: number
  completed: boolean
}

export interface SessionManifest {
  version: 1
  meetingId: string
  activePartIndex: number
  totalBytes: number
  durationMs: number
  finalized?: boolean
  parts: RecordingPartManifest[]
}

export function createSessionManifest(meetingId: string): SessionManifest {
  return {
    version: 1,
    meetingId,
    activePartIndex: 0,
    totalBytes: 0,
    durationMs: 0,
    finalized: false,
    parts: [],
  }
}

export function isFinalizedSessionManifest(manifest: SessionManifest): boolean {
  if (manifest.finalized !== undefined) return manifest.finalized
  if (manifest.parts.length === 0 || !manifest.parts.every(({ completed }) => completed)) {
    return false
  }
  return manifest.activePartIndex === manifest.parts.length - 1
}

function assertNonNegativeInteger(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid recording manifest ${field}`)
  }
}

function parseSessionManifest(value: unknown, meetingId: string): SessionManifest {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Invalid recording manifest')
  }
  const manifest = value as Record<string, unknown>
  if (manifest.version !== 1 || manifest.meetingId !== meetingId || !Array.isArray(manifest.parts)) {
    throw new Error('Invalid recording manifest identity')
  }
  assertNonNegativeInteger(manifest.activePartIndex, 'activePartIndex')
  assertNonNegativeInteger(manifest.totalBytes, 'totalBytes')
  assertNonNegativeInteger(manifest.durationMs, 'durationMs')
  if (manifest.finalized !== undefined && typeof manifest.finalized !== 'boolean') {
    throw new Error('Invalid recording manifest finalized')
  }

  const parts = manifest.parts.map((value, index): RecordingPartManifest => {
    if (typeof value !== 'object' || value === null) {
      throw new Error(`Invalid recording manifest part ${index}`)
    }
    const part = value as Record<string, unknown>
    assertNonNegativeInteger(part.partIndex, `parts[${index}].partIndex`)
    if (
      typeof part.lastChunkIndex !== 'number' ||
      !Number.isInteger(part.lastChunkIndex) ||
      part.lastChunkIndex < -1
    ) {
      throw new Error(`Invalid recording manifest parts[${index}].lastChunkIndex`)
    }
    assertNonNegativeInteger(part.byteCount, `parts[${index}].byteCount`)
    assertNonNegativeInteger(part.durationMs, `parts[${index}].durationMs`)
    if (typeof part.completed !== 'boolean') {
      throw new Error(`Invalid recording manifest parts[${index}].completed`)
    }
    return {
      partIndex: part.partIndex,
      lastChunkIndex: part.lastChunkIndex,
      byteCount: part.byteCount,
      durationMs: part.durationMs,
      completed: part.completed,
    }
  })

  return {
    version: 1,
    meetingId,
    activePartIndex: manifest.activePartIndex,
    totalBytes: manifest.totalBytes,
    durationMs: manifest.durationMs,
    finalized: manifest.finalized as boolean | undefined,
    parts,
  }
}

export async function readSessionManifest(
  recordingsDirectory: string,
  meetingId: string,
): Promise<SessionManifest | null> {
  try {
    const json = await readFile(manifestPath(recordingsDirectory, meetingId), 'utf8')
    return parseSessionManifest(JSON.parse(json), meetingId)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

export async function writeSessionManifest(
  recordingsDirectory: string,
  manifest: SessionManifest,
): Promise<void> {
  const destination = manifestPath(recordingsDirectory, manifest.meetingId)
  const temporary = temporaryManifestPath(recordingsDirectory, manifest.meetingId)
  await mkdir(dirname(destination), { recursive: true })
  const handle = await open(temporary, 'w')
  try {
    await handle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporary, destination)
}
