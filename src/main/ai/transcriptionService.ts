import { createHash } from 'node:crypto'
import { lstat, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import type { Speaker, TranscriptSegment } from '../../shared/contracts/meeting'
import type { MeetingRepository } from '../db/meetingRepository'
import type { NormalizedTranscription, TranscriptionProvider } from './providers/providerPorts'
import { safeProviderError, toProviderError } from './providers/providerErrors'
import { createWebmAudioChunker, type AudioChunker, type AudioChunkSet } from './audioChunker'
import { WebmSplitError } from '../media/webmSplit'
import { PROCESS_OWNER_ID } from './processingOwner'

export interface TranscriptionResult {
  speakers: Speaker[]
  segments: TranscriptSegment[]
}

function validateProviderTiming(response: NormalizedTranscription): void {
  if (!Number.isFinite(response.durationSeconds) || response.durationSeconds < 0) {
    throw safeProviderError('TRANSCRIPTION_MALFORMED_RESPONSE', 'The transcription provider returned an invalid response.', false)
  }
  let previousStart = 0
  for (const segment of response.segments) {
    if (
      !Number.isFinite(segment.startSeconds) ||
      !Number.isFinite(segment.endSeconds) ||
      segment.startSeconds < previousStart ||
      segment.startSeconds < 0 ||
      segment.endSeconds < segment.startSeconds ||
      segment.endSeconds > response.durationSeconds + 0.001 ||
      typeof segment.text !== 'string' ||
      (segment.speakerLabel !== null && (typeof segment.speakerLabel !== 'string' || segment.speakerLabel.length === 0))
    ) {
      throw safeProviderError('TRANSCRIPTION_MALFORMED_RESPONSE', 'The transcription provider returned an invalid response.', false)
    }
    previousStart = segment.startSeconds
  }
}

// Whisper-family decoders degenerate on silence and noise, emitting the same
// hypothesis for chunk after chunk. Six identical sentences across five seconds
// is the model looping, not the room, so fold a repeat back into the segment it
// repeats and keep the span it covered.
export function collapseRepeatedSegments(
  segments: readonly TranscriptSegment[],
): TranscriptSegment[] {
  const collapsed: TranscriptSegment[] = []
  for (const segment of segments) {
    const previous = collapsed.at(-1)
    const text = segment.text.trim()
    if (
      previous !== undefined &&
      text.length > 0 &&
      previous.speakerId === segment.speakerId &&
      previous.text.trim() === text
    ) {
      previous.endMs = Math.max(previous.endMs, segment.endMs)
      continue
    }
    collapsed.push({ ...segment })
  }
  return collapsed
}

export class TranscriptionService {
  constructor(
    private readonly meetings: MeetingRepository,
    private readonly resolveProvider: () => Pick<TranscriptionProvider, 'transcribe' | 'maxAudioDurationSeconds'>,
    private readonly recordingsDirectory: string,
    private readonly ownerId = PROCESS_OWNER_ID,
    private readonly chunker: AudioChunker = createWebmAudioChunker(tmpdir()),
  ) {}

  async transcribeMeeting(
    meetingId: string,
    orchestration?: { attemptId: string; ownerId: string },
  ): Promise<TranscriptionResult> {
    const ownAttempt = orchestration === undefined
      ? this.meetings.beginProcessingAttempt(meetingId, 'transcription', this.ownerId)
      : null
    try {
      if (orchestration === undefined) {
        this.meetings.beginTranscription(meetingId)
      } else {
        this.meetings.assertActiveProcessingAttempt(
          orchestration.attemptId,
          meetingId,
          'transcribing',
          orchestration.ownerId,
        )
        if (this.meetings.requireById(meetingId).status !== 'transcribing') {
          throw new Error('Orchestrated transcription is not in the transcribing state')
        }
      }
      const provider = this.resolveProvider()
      const parts = await this.finalizedParts(meetingId)
      const speakers = new Map<string, Speaker>()
      const segments: TranscriptSegment[] = []
      let offsetSeconds = 0
      const meetingPrefix = createHash('sha256').update(meetingId, 'utf8').digest('hex')

      for (const [partIndex, part] of parts.entries()) {
        const pieces = await this.fittingPieces(part, provider.maxAudioDurationSeconds)
        try {
          for (const [pieceIndex, piece] of pieces.chunks.entries()) {
            // A provider names its speakers per request, so labels from two
            // requests are not the same people. Each piece keeps its own
            // namespace, exactly as separate recording parts already do.
            const namespace = pieces.chunks.length === 1 ? `${partIndex}` : `${partIndex}.${pieceIndex}`
            const response = await provider.transcribe({
              filePath: piece.filePath,
              ...(piece.durationSeconds === undefined ? {} : { recordingDurationSeconds: piece.durationSeconds }),
            })
            validateProviderTiming(response)
            response.segments.forEach((segment, segmentIndex) => {
              const providerSpeaker = segment.speakerLabel === null
                ? null
                : encodeURIComponent(segment.speakerLabel)
              const speakerId = providerSpeaker === null
                ? null
                : `${meetingPrefix}:${namespace}:${providerSpeaker}`
              if (speakerId !== null) {
                speakers.set(speakerId, {
                  id: speakerId,
                  meetingId,
                  displayName: `Speaker ${segment.speakerLabel}`,
                })
              }
              segments.push({
                id: `${meetingPrefix}:${namespace}:${providerSpeaker ?? 'segment'}:${segmentIndex}`,
                meetingId,
                speakerId,
                startMs: Math.round((offsetSeconds + segment.startSeconds) * 1_000),
                endMs: Math.round((offsetSeconds + segment.endSeconds) * 1_000),
                text: segment.text,
              })
            })
            offsetSeconds += response.durationSeconds
          }
        } finally {
          await pieces.dispose()
        }
      }

      const result = this.meetings.completeTranscription(
        meetingId,
        [...speakers.values()],
        collapseRepeatedSegments(segments),
      )
      if (ownAttempt !== null) this.meetings.finishProcessingAttempt(ownAttempt.id, { succeeded: true })
      return result
    } catch (error) {
      const typed = toProviderError(error)
      try {
        if (this.meetings.requireById(meetingId).status === 'transcribing') {
          this.meetings.failTranscription(meetingId, {
            code: typed.code,
            message: typed.message,
            retryable: typed.retryable,
          })
        }
      } catch {
        // Attempt completion below must not be blocked by secondary failure persistence.
      }
      if (ownAttempt !== null) {
        this.meetings.finishProcessingAttempt(ownAttempt.id, {
          succeeded: false,
          error: { code: typed.code, message: typed.message, retryable: typed.retryable },
        })
      }
      throw typed
    }
  }

  // Recordings made before parts were rolled on length, and any part a future
  // provider considers too long, are cut into acceptable pieces on the way out.
  private async fittingPieces(
    part: { filePath: string; durationSeconds?: number },
    maxAudioDurationSeconds: number | undefined,
  ): Promise<AudioChunkSet> {
    if (maxAudioDurationSeconds === undefined) {
      return { chunks: [part], dispose: async () => { /* nothing was written */ } }
    }
    try {
      return await this.chunker.chunk({ ...part, maxDurationSeconds: maxAudioDurationSeconds })
    } catch (error) {
      if (error instanceof WebmSplitError) {
        throw safeProviderError('TRANSCRIPTION_INVALID_AUDIO', 'The transcription provider could not process this audio file.', false)
      }
      throw error
    }
  }

  private async finalizedParts(meetingId: string): Promise<Array<{ filePath: string; durationSeconds?: number }>> {
    const resolvedRoot = await realpath(this.recordingsDirectory)
    const meeting = this.meetings.requireById(meetingId)
    const durable = this.meetings.listRecordingParts(meetingId)
    let previousDurationMs = 0
    const parts: Array<{ name: string; index: number; durationSeconds?: number }> = durable.length > 0
      ? durable.map((part): { name: string; index: number; durationSeconds: number } => {
          const durationMs = part.durationMs - previousDurationMs
          previousDurationMs = part.durationMs
          return { name: part.relativePath, index: part.partIndex, durationSeconds: durationMs / 1_000 }
        })
      : meeting.audioPath === null ? [] : [{ name: meeting.audioPath, index: 0 }]
    if (parts.length === 0 || parts.some((part, index) => part.index !== index || basename(part.name) !== part.name
      || (part.durationSeconds !== undefined && (!Number.isFinite(part.durationSeconds) || part.durationSeconds < 0)))) {
      throw safeProviderError('TRANSCRIPTION_INVALID_AUDIO', 'The transcription provider could not process this audio file.', false)
    }
    return Promise.all(
      parts.map(async ({ name, durationSeconds }) => {
        const part = durationSeconds === undefined ? {} : { durationSeconds }
        const candidate = join(this.recordingsDirectory, name)
        const details = await lstat(candidate)
        if (details.isSymbolicLink() || !details.isFile()) {
          throw safeProviderError('TRANSCRIPTION_INVALID_AUDIO', 'The transcription provider could not process this audio file.', false)
        }
        const resolved = await realpath(candidate)
        const fromRoot = relative(resolvedRoot, resolved)
        if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
          throw safeProviderError('TRANSCRIPTION_INVALID_AUDIO', 'The transcription provider could not process this audio file.', false)
        }
        return { filePath: resolved, ...part }
      }),
    )
  }
}
