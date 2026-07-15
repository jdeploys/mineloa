import { createHash } from 'node:crypto'
import { lstat, realpath } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import type { Speaker, TranscriptSegment } from '../../shared/contracts/meeting'
import type { MeetingRepository } from '../db/meetingRepository'
import type { OpenAiGatewayPort, ProviderTranscription } from './openAiGateway'
import { safeOpenAiError, toOpenAiError } from './openAiErrors'
import { PROCESS_OWNER_ID } from './processingOwner'

export interface TranscriptionResult {
  speakers: Speaker[]
  segments: TranscriptSegment[]
}

function validateProviderTiming(response: ProviderTranscription): void {
  if (!Number.isFinite(response.durationSeconds) || response.durationSeconds < 0) {
    throw safeOpenAiError('OPENAI_MALFORMED_RESPONSE')
  }
  let previousStart = 0
  for (const segment of response.segments) {
    if (
      !segment.speaker ||
      !Number.isFinite(segment.startSeconds) ||
      !Number.isFinite(segment.endSeconds) ||
      segment.startSeconds < previousStart ||
      segment.startSeconds < 0 ||
      segment.endSeconds < segment.startSeconds ||
      segment.endSeconds > response.durationSeconds + 0.001 ||
      typeof segment.text !== 'string'
    ) {
      throw safeOpenAiError('OPENAI_MALFORMED_RESPONSE')
    }
    previousStart = segment.startSeconds
  }
}

export class TranscriptionService {
  constructor(
    private readonly meetings: MeetingRepository,
    private readonly gateway: OpenAiGatewayPort,
    private readonly recordingsDirectory: string,
    private readonly ownerId = PROCESS_OWNER_ID,
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
      const paths = await this.finalizedPartPaths(meetingId)
      const speakers = new Map<string, Speaker>()
      const segments: TranscriptSegment[] = []
      let offsetSeconds = 0
      const meetingPrefix = createHash('sha256').update(meetingId, 'utf8').digest('hex')

      for (const [partIndex, filePath] of paths.entries()) {
        const response = await this.gateway.transcribe({
          filePath,
          model: 'gpt-4o-transcribe-diarize',
          responseFormat: 'diarized_json',
          chunkingStrategy: 'auto',
        })
        validateProviderTiming(response)
        response.segments.forEach((segment, segmentIndex) => {
          const providerSpeaker = encodeURIComponent(segment.speaker)
          const speakerId = `${meetingPrefix}:${partIndex}:${providerSpeaker}`
          speakers.set(speakerId, {
            id: speakerId,
            meetingId,
            displayName: `Speaker ${segment.speaker}`,
          })
          segments.push({
            id: `${meetingPrefix}:${partIndex}:${providerSpeaker}:${segmentIndex}`,
            meetingId,
            speakerId,
            startMs: Math.round((offsetSeconds + segment.startSeconds) * 1_000),
            endMs: Math.round((offsetSeconds + segment.endSeconds) * 1_000),
            text: segment.text,
          })
        })
        offsetSeconds += response.durationSeconds
      }

      const result = this.meetings.completeTranscription(meetingId, [...speakers.values()], segments)
      if (ownAttempt !== null) this.meetings.finishProcessingAttempt(ownAttempt.id, { succeeded: true })
      return result
    } catch (error) {
      const typed = toOpenAiError(error)
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

  private async finalizedPartPaths(meetingId: string): Promise<string[]> {
    const resolvedRoot = await realpath(this.recordingsDirectory)
    const meeting = this.meetings.requireById(meetingId)
    const durable = this.meetings.listRecordingParts(meetingId)
    const parts = durable.length > 0
      ? durable.map((part) => ({ name: part.relativePath, index: part.partIndex }))
      : meeting.audioPath === null ? [] : [{ name: meeting.audioPath, index: 0 }]
    if (parts.length === 0 || parts.some((part, index) => part.index !== index || basename(part.name) !== part.name)) {
      throw safeOpenAiError('OPENAI_INVALID_AUDIO')
    }
    return Promise.all(
      parts.map(async ({ name }) => {
        const candidate = join(this.recordingsDirectory, name)
        const details = await lstat(candidate)
        if (details.isSymbolicLink() || !details.isFile()) {
          throw safeOpenAiError('OPENAI_INVALID_AUDIO')
        }
        const resolved = await realpath(candidate)
        const fromRoot = relative(resolvedRoot, resolved)
        if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
          throw safeOpenAiError('OPENAI_INVALID_AUDIO')
        }
        return resolved
      }),
    )
  }
}
