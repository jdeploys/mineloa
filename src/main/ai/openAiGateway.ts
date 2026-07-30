import { createReadStream } from 'node:fs'
import OpenAI from 'openai'
import { Agent } from 'undici'
import { z } from 'zod'
import type { CredentialStore } from '../credentials/credentialStore'
import { safeOpenAiError, toOpenAiError, toSummaryOpenAiError } from './openAiErrors'
import type { SummaryRequest } from './providers/providerPorts'

export interface TranscriptionRequest {
  filePath: string
  recordingDurationSeconds?: number
  model: 'gpt-4o-transcribe-diarize'
  responseFormat: 'diarized_json'
  chunkingStrategy: 'auto'
}

export interface ProviderTranscriptSegment {
  speaker: string
  startSeconds: number
  endSeconds: number
  text: string
}

export interface ProviderTranscription {
  durationSeconds: number
  segments: ProviderTranscriptSegment[]
}

export interface OpenAiGatewayPort {
  transcribe(request: TranscriptionRequest): Promise<ProviderTranscription>
}

export interface OpenAiRequestOptions {
  timeout: number
  maxRetries: number
}

export interface OpenAiTranscriptionClient {
  audio: { transcriptions: { create(input: unknown, options?: OpenAiRequestOptions): Promise<unknown> } }
}

export type OpenAiTranscriptionClientFactory = (apiKey: string) => OpenAiTranscriptionClient

// Node's fetch stops waiting for response headers after five minutes, and that
// socket-level ceiling sits underneath the SDK, so raising the SDK timeout on
// its own still lost long transcriptions at exactly 300s. Drop both socket
// deadlines and let each request's own budget be the only one that applies.
export const OPENAI_SOCKET_TIMEOUTS = { headersTimeout: 0, bodyTimeout: 0 } as const

const openAiDispatcher = new Agent(OPENAI_SOCKET_TIMEOUTS)

const createClient: OpenAiTranscriptionClientFactory = (apiKey) => new OpenAI({
  apiKey,
  fetchOptions: { dispatcher: openAiDispatcher },
})

// The diarized endpoint is not streaming: nothing comes back until the whole
// transcript is ready, so the request has to outlive the server-side work.
// openai-node defaults to a ten minute timeout, which aborts mid-job on long
// recordings, and its retries re-upload the audio only to hit the same wall.
// Budget from the recording length instead, and let a timeout stay terminal.
const TRANSCRIPTION_TIMEOUT_FLOOR_MS = 15 * 60 * 1_000
const TRANSCRIPTION_TIMEOUT_CEILING_MS = 60 * 60 * 1_000
const TRANSCRIPTION_TIMEOUT_PER_AUDIO_SECOND_MS = 2_000

export function transcriptionTimeoutMs(recordingDurationSeconds: number | undefined): number {
  if (recordingDurationSeconds === undefined || !Number.isFinite(recordingDurationSeconds)) {
    return TRANSCRIPTION_TIMEOUT_FLOOR_MS
  }
  const scaled = recordingDurationSeconds * TRANSCRIPTION_TIMEOUT_PER_AUDIO_SECOND_MS
  if (scaled <= TRANSCRIPTION_TIMEOUT_FLOOR_MS) return TRANSCRIPTION_TIMEOUT_FLOOR_MS
  return Math.min(TRANSCRIPTION_TIMEOUT_CEILING_MS, scaled)
}

const responseSchema = z.object({
  duration: z.number().finite().nonnegative().optional(),
  segments: z.array(
    z.object({
      speaker: z.string().min(1),
      start: z.number().finite().nonnegative(),
      end: z.number().finite().nonnegative(),
      text: z.string(),
    }),
  ),
})

export class OpenAiGateway implements OpenAiGatewayPort {
  constructor(
    private readonly credentials: CredentialStore,
    private readonly clientFactory: OpenAiTranscriptionClientFactory = createClient,
  ) {}

  async transcribe(request: TranscriptionRequest): Promise<ProviderTranscription> {
    const apiKey = await this.credentials.get()
    if (apiKey === null) {
      throw safeOpenAiError('OPENAI_API_KEY_MISSING')
    }

    let response: unknown
    try {
      response = await this.clientFactory(apiKey).audio.transcriptions.create({
        file: createReadStream(request.filePath),
        model: request.model,
        response_format: request.responseFormat,
        chunking_strategy: request.chunkingStrategy,
      }, {
        timeout: transcriptionTimeoutMs(request.recordingDurationSeconds),
        // A retry re-uploads the whole recording and then waits out the same
        // budget again, so a timeout here surfaces instead of tripling the wait.
        maxRetries: 0,
      })
    } catch (error) {
      throw toOpenAiError(error)
    }
    const parsed = responseSchema.safeParse(response)
    if (!parsed.success) {
      throw safeOpenAiError('OPENAI_MALFORMED_RESPONSE')
    }

    // The non-streaming diarized endpoint can omit its documented top-level
    // duration. The recording service owns a durable duration for every part,
    // so use that instead of rejecting an otherwise valid transcript.
    const duration = request.recordingDurationSeconds ?? parsed.data.duration
    if (duration === undefined || !Number.isFinite(duration) || duration < 0) {
      throw safeOpenAiError('OPENAI_MALFORMED_RESPONSE')
    }

    let previousStart = 0
    for (const segment of parsed.data.segments) {
      if (
        segment.end < segment.start ||
        segment.start < previousStart ||
        segment.end > duration + 0.001
      ) {
        throw safeOpenAiError('OPENAI_MALFORMED_RESPONSE')
      }
      previousStart = segment.start
    }
    return {
      durationSeconds: duration,
      segments: parsed.data.segments.map((segment) => ({
        speaker: segment.speaker,
        startSeconds: segment.start,
        endSeconds: segment.end,
        text: segment.text,
      })),
    }
  }
}

export interface OpenAiSummaryGatewayPort {
  summarize(request: SummaryRequest): Promise<string>
}

export interface OpenAiResponsesClient {
  responses: { create(input: unknown): Promise<unknown> }
}

export type OpenAiResponsesClientFactory = (apiKey: string) => OpenAiResponsesClient

// Summaries are short today, but they grow with the transcript and would hit
// the same 300s socket ceiling as transcription. The SDK timeout still bounds
// them; only the socket deadline is lifted.
const createResponsesClient: OpenAiResponsesClientFactory = (apiKey) => new OpenAI({
  apiKey,
  fetchOptions: { dispatcher: openAiDispatcher },
})

const responsesResultSchema = z.object({
  status: z.string(),
  output_text: z.string(),
  output: z.array(z.unknown()),
}).passthrough()

function containsRefusal(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsRefusal)
  if (typeof value !== 'object' || value === null) return false
  if ('type' in value && value.type === 'refusal') return true
  return Object.values(value).some(containsRefusal)
}

export class OpenAiSummaryGateway implements OpenAiSummaryGatewayPort {
  constructor(
    private readonly credentials: CredentialStore,
    private readonly clientFactory: OpenAiResponsesClientFactory = createResponsesClient,
  ) {}

  async summarize(request: SummaryRequest): Promise<string> {
    const apiKey = await this.credentials.get()
    if (apiKey === null) throw safeOpenAiError('OPENAI_API_KEY_MISSING')
    let response: unknown
    try {
      response = await this.clientFactory(apiKey).responses.create({
        model: 'gpt-5-mini',
        input: request.input,
        text: {
          format: {
            type: 'json_schema',
            name: 'nnote_meeting_summary',
            strict: true,
            schema: request.schema,
          },
        },
      })
    } catch (error) {
      throw toSummaryOpenAiError(error)
    }
    const parsed = responsesResultSchema.safeParse(response)
    if (!parsed.success) throw safeOpenAiError('OPENAI_MALFORMED_SUMMARY')
    if (containsRefusal(parsed.data.output)) throw safeOpenAiError('OPENAI_SUMMARY_REFUSED')
    if (parsed.data.status !== 'completed') throw safeOpenAiError('OPENAI_SUMMARY_INCOMPLETE')
    if (parsed.data.output_text.trim().length === 0) throw safeOpenAiError('OPENAI_MALFORMED_SUMMARY')
    return parsed.data.output_text
  }
}
