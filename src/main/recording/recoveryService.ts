import { lstat, open, readdir, rename, rm, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import type { MeetingRepository } from '../db/meetingRepository'
import type { RecoveryItem } from '../../shared/contracts/recovery'
import type { RecordingProgress } from '../../shared/contracts/recording'
import {
  completedPartPath,
  manifestPath,
  pendingPartPath,
  recordingFilePrefix,
  temporaryManifestPath,
} from './recordingPaths'
import type { RecordingService } from './recordingService'
import {
  isFinalizedSessionManifest,
  readSessionManifest,
  type SessionManifest,
} from './sessionManifest'

type RecoveryKind = RecoveryItem['kind']
type PreservedPart = { entry: string; partIndex: number; pending: boolean }

export class RecoveryService {
  private readonly inspected = new Map<string, RecoveryKind>()
  private readonly resolved = new Set<string>()

  constructor(
    private readonly meetings: MeetingRepository,
    private readonly recording: RecordingService,
    private readonly recordingsDirectory: string,
  ) {}

  async scan(): Promise<RecoveryItem[]> {
    const candidates = this.meetings.listByStatuses(['recording', 'recoverable'])
    const items: RecoveryItem[] = []
    for (const meeting of candidates) {
      if (this.resolved.has(meeting.id)) continue
      const inspection = await this.inspect(meeting.id)
      if (meeting.status === 'recording') {
        this.meetings.transitionRecordingStatus(meeting.id, 'recoverable')
      }
      this.inspected.set(meeting.id, inspection.kind)
      items.push({
        meetingId: meeting.id,
        createdAt: meeting.createdAt,
        durationMs: inspection.durationMs ?? meeting.durationMs,
        byteCount: inspection.byteCount,
        kind: inspection.kind,
      })
    }
    return items
  }

  async recover(meetingId: string): Promise<RecordingProgress> {
    this.requireStartupRecovery(meetingId, 'recoverable')
    const meeting = this.meetings.requireById(meetingId)
    if (meeting.status === 'recording') return this.recording.start(meetingId)
    if (meeting.status !== 'recoverable') throw new Error(`Meeting ${meetingId} is not recoverable`)
    const inspection = await this.inspect(meetingId)
    if (inspection.kind !== 'recoverable') throw new Error('This recording cannot be resumed; its bytes are export-only')

    this.meetings.transitionRecordingStatus(meetingId, 'recording')
    try {
      const started = await this.recording.start(meetingId)
      const progress = started.nextChunkIndex > 0
        ? await this.recording.rollPart(meetingId, started.activePartIndex)
        : started
      this.inspected.delete(meetingId)
      this.resolved.add(meetingId)
      return progress
    } catch (error) {
      await this.recording.suspendRecovery(meetingId).catch(() => undefined)
      this.meetings.transitionRecordingStatus(meetingId, 'recoverable')
      throw error
    }
  }

  async keepAsFile(meetingId: string): Promise<void> {
    const meeting = this.meetings.requireById(meetingId)
    if (meeting.status === 'recorded') return
    const kind = this.requireStartupRecovery(meetingId)
    if (kind === 'exportOnly') throw new Error('This recording is export-only')
    if (meeting.status !== 'recording' && meeting.status !== 'recoverable') {
      throw new Error(`Meeting ${meetingId} cannot be kept as a file`)
    }
    const inspection = await this.inspect(meetingId)
    if (inspection.kind === 'exportOnly') throw new Error('This recording is export-only')
    await this.recording.keepRecoveredAsFile(meetingId)
    this.inspected.delete(meetingId)
  }

  async suspend(meetingId: string): Promise<void> {
    const meeting = this.meetings.requireById(meetingId)
    if (meeting.status !== 'recording' || !this.resolved.has(meetingId)) {
      throw new Error('Only the currently attached startup recovery can be suspended')
    }
    await this.recording.suspendRecovery(meetingId)
    this.meetings.transitionRecordingStatus(meetingId, 'recoverable')
    this.resolved.delete(meetingId)
    this.inspected.set(meetingId, 'recoverable')
  }

  async exportOnly(meetingId: string, destinationPath: string): Promise<void> {
    this.requireStartupRecovery(meetingId, 'exportOnly')
    if (!isAbsolute(destinationPath)) throw new Error('Recovery export destination must be absolute')
    const recordingsRoot = resolve(this.recordingsDirectory)
    const destination = resolve(destinationPath)
    const fromRoot = relative(recordingsRoot, destination)
    if (fromRoot === '' || (!fromRoot.startsWith('..') && !isAbsolute(fromRoot))) {
      throw new Error('Recovery export cannot overwrite preserved recording storage')
    }
    const entries = await this.preservedParts(meetingId)

    const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`
    const output = await open(temporary, 'wx')
    try {
      if (entries.length > 1) {
        const files: Record<string, Uint8Array> = {}
        const parts: Array<{ partIndex: number; entry: string; byteCount: number }> = []
        for (const part of entries) {
          const bytes = await this.readStablePart(part)
          const entry = `audio/part-${part.partIndex}.webm`
          files[entry] = bytes
          parts.push({ partIndex: part.partIndex, entry, byteCount: bytes.byteLength })
        }
        files['manifest.json'] = strToU8(JSON.stringify({ format: 'nnote-recovery', version: 1, parts }))
        await output.writeFile(zipSync(files, { level: 0 }))
      } else for (const { entry } of entries) {
        const source = join(this.recordingsDirectory, entry)
        const info = await lstat(source)
        if (!info.isFile() || info.isSymbolicLink()) throw new Error('Preserved recording part must be a regular file')
        const input = await open(source, 'r')
        try {
          const buffer = Buffer.allocUnsafe(64 * 1024)
          let position = 0
          while (position < info.size) {
            const { bytesRead } = await input.read(buffer, 0, Math.min(buffer.length, info.size - position), position)
            if (bytesRead === 0) throw new Error('Preserved recording part changed during export')
            await output.writeFile(buffer.subarray(0, bytesRead))
            position += bytesRead
          }
          if ((await input.stat()).size !== info.size) throw new Error('Preserved recording part changed during export')
        } finally { await input.close() }
      }
      await output.sync()
      await output.close()
      await rename(temporary, destination)
    } catch (error) {
      await output.close().catch(() => undefined)
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }

  async exportOnlyFormat(meetingId: string): Promise<{ partCount: number; extension: 'webm' | 'zip' }> {
    this.requireStartupRecovery(meetingId, 'exportOnly')
    const parts = await this.preservedParts(meetingId)
    return { partCount: parts.length, extension: parts.length === 1 ? 'webm' : 'zip' }
  }

  async discard(meetingId: string, options: { explicitDelete: boolean }): Promise<void> {
    if (options.explicitDelete !== true) throw new Error('Recovery deletion requires explicitDelete true')
    const meeting = this.meetings.requireById(meetingId)
    if (meeting.status === 'deleted') return
    this.requireStartupRecovery(meetingId)
    if (meeting.status !== 'recording' && meeting.status !== 'recoverable') {
      throw new Error(`Meeting ${meetingId} is not an interrupted recording`)
    }
    const prefix = recordingFilePrefix(meetingId)
    let entries: string[] = []
    try {
      entries = await readdir(this.recordingsDirectory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await Promise.all(
      entries.filter((entry) => entry.startsWith(prefix)).map((entry) => rm(join(this.recordingsDirectory, entry), { force: true })),
    )
    await rm(manifestPath(this.recordingsDirectory, meetingId), { force: true })
    await rm(temporaryManifestPath(this.recordingsDirectory, meetingId), { force: true })
    this.meetings.discardRecording(meetingId)
    this.inspected.delete(meetingId)
  }

  private async inspect(meetingId: string): Promise<{ kind: RecoveryKind; byteCount: number; durationMs?: number }> {
    try {
      const manifest = await readSessionManifest(this.recordingsDirectory, meetingId)
      if (manifest === null) return { kind: 'exportOnly', byteCount: await this.preservedByteCount(meetingId) }
      await this.assertReconciliable(manifest)
      const kind: RecoveryKind = isFinalizedSessionManifest(manifest)
        ? 'finalizeOnly'
        : 'recoverable'
      return { kind, byteCount: manifest.totalBytes, durationMs: manifest.durationMs }
    } catch {
      return { kind: 'exportOnly', byteCount: await this.preservedByteCount(meetingId) }
    }
  }

  private requireStartupRecovery(meetingId: string, requiredKind?: RecoveryKind): RecoveryKind {
    const kind = this.inspected.get(meetingId)
    if (kind === undefined) {
      throw new Error(`Meeting ${meetingId} is not an eligible startup recovery`)
    }
    if (requiredKind !== undefined && kind !== requiredKind) {
      throw new Error(
        kind === 'finalizeOnly'
          ? 'This recording cannot be resumed; it can only be finalized'
          : 'This recording cannot be resumed; its bytes are export-only',
      )
    }
    return kind
  }

  private async assertReconciliable(manifest: SessionManifest): Promise<void> {
    const seen = new Set<number>()
    let totalBytes = 0
    let previousDuration = 0
    let foundIncomplete = false
    const expectedFiles = new Set<string>()
    for (const [index, part] of manifest.parts.entries()) {
      if (seen.has(part.partIndex)) throw new Error('Duplicate recording part')
      if (part.partIndex !== index) throw new Error('Recording parts are not contiguous')
      if (part.lastChunkIndex < 0) throw new Error('Recording part has no committed chunk cursor')
      if (part.durationMs < previousDuration || part.durationMs > manifest.durationMs) {
        throw new Error('Recording part duration cursor is incoherent')
      }
      if (foundIncomplete || (!part.completed && index !== manifest.parts.length - 1)) {
        throw new Error('Recording completion flags are incoherent')
      }
      if (!part.completed) foundIncomplete = true
      seen.add(part.partIndex)
      totalBytes += part.byteCount
      previousDuration = part.durationMs
      const pendingPath = pendingPartPath(this.recordingsDirectory, manifest.meetingId, part.partIndex)
      const completedPath = completedPartPath(this.recordingsDirectory, manifest.meetingId, part.partIndex)
      const pending = await this.fileSize(pendingPath)
      const completed = await this.fileSize(completedPath)
      if (pending !== null && completed !== null) throw new Error('Recording part exists twice')
      const actual = pending ?? completed
      if (actual === null || actual < part.byteCount) throw new Error('Recording part does not agree with manifest')
      expectedFiles.add((pending !== null ? pendingPath : completedPath).split(/[\\/]/).pop()!)
    }
    if (totalBytes !== manifest.totalBytes) throw new Error('Recording total does not agree with manifest')
    if (manifest.parts.length === 0) {
      if (manifest.totalBytes !== 0 || manifest.durationMs !== 0 || manifest.activePartIndex !== 0) {
        throw new Error('Empty recording cursor is incoherent')
      }
    } else {
      if (previousDuration !== manifest.durationMs) throw new Error('Recording duration does not agree with parts')
      const lastIndex = manifest.parts.length - 1
      const expectedActive = foundIncomplete ? lastIndex : manifest.parts.length
      const finalizedActiveIsValid =
        isFinalizedSessionManifest(manifest) &&
        manifest.parts.every(({ completed }) => completed) &&
        (manifest.activePartIndex === lastIndex || manifest.activePartIndex === manifest.parts.length)
      if (manifest.activePartIndex !== expectedActive && !finalizedActiveIsValid) {
        throw new Error('Active recording cursor is incoherent')
      }
      if (isFinalizedSessionManifest(manifest) && foundIncomplete) {
        throw new Error('Finalized recording contains an incomplete part')
      }
    }

    const prefix = recordingFilePrefix(manifest.meetingId)
    const entries = await readdir(this.recordingsDirectory)
    const actualFiles = entries.filter(
      (entry) => entry.startsWith(prefix) && (entry.endsWith('.webm') || entry.endsWith('.webm.part')),
    )
    if (actualFiles.length !== expectedFiles.size || actualFiles.some((entry) => !expectedFiles.has(entry))) {
      throw new Error('Recording files do not agree with manifest topology')
    }
  }

  private async preservedByteCount(meetingId: string): Promise<number> {
    const prefix = recordingFilePrefix(meetingId)
    try {
      const entries = await readdir(this.recordingsDirectory)
      let total = 0
      for (const entry of entries) {
        if (!entry.startsWith(prefix) || (!entry.endsWith('.webm') && !entry.endsWith('.webm.part'))) continue
        total += (await stat(join(this.recordingsDirectory, entry))).size
      }
      return total
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
      throw error
    }
  }

  private async preservedParts(meetingId: string): Promise<PreservedPart[]> {
    const prefix = recordingFilePrefix(meetingId)
    const entries = (await readdir(this.recordingsDirectory))
      .filter((entry) => entry.startsWith(prefix) && (entry.endsWith('.webm') || entry.endsWith('.webm.part')))
      .map((entry) => {
        const match = entry.match(/\.part-(\d+)\.webm(?:\.part)?$/)
        if (match === null) throw new Error('Preserved recording part has an invalid name')
        return { entry, partIndex: Number(match[1]), pending: entry.endsWith('.webm.part') }
      })
      .sort((left, right) => left.partIndex - right.partIndex || Number(left.pending) - Number(right.pending))
    if (entries.length === 0) throw new Error('No preserved recording bytes are available')
    if (new Set(entries.map(({ partIndex }) => partIndex)).size !== entries.length) throw new Error('Preserved recording part topology is ambiguous')
    return entries
  }

  private async readStablePart(part: PreservedPart): Promise<Uint8Array> {
    const source = join(this.recordingsDirectory, part.entry)
    const info = await lstat(source)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Preserved recording part must be a regular file')
    const input = await open(source, 'r')
    try {
      const bytes = new Uint8Array(info.size)
      let position = 0
      while (position < info.size) {
        const { bytesRead } = await input.read(bytes, position, info.size - position, position)
        if (bytesRead === 0) throw new Error('Preserved recording part changed during export')
        position += bytesRead
      }
      if ((await input.stat()).size !== info.size) throw new Error('Preserved recording part changed during export')
      return bytes
    } finally { await input.close() }
  }

  private async fileSize(path: string): Promise<number | null> {
    try { return (await stat(path)).size } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }
}
